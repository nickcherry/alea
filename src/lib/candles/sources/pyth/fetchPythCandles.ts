import { pythResolution } from "@alea/lib/candles/sources/pyth/pythResolution";
import { pythSymbol } from "@alea/lib/candles/sources/pyth/pythSymbol";
import type { Asset } from "@alea/types/assets";
import type { Candle, CandleTimeframe } from "@alea/types/candles";
import { z } from "zod";

const baseUrl = "https://benchmarks.pyth.network/v1/shims/tradingview/history";

/**
 * Pyth's TradingView shim caps responses at exactly 10,000 bars — at
 * 10,001 you get `{"s":"error","errmsg":"Too many datapoints to return"}`.
 * Page in 9,000-bar windows to stay comfortably under the cap. This was
 * 1,000 originally based on a misread of the docs; bumping to 9,000 cuts
 * the request count for a 1m backfill 9× and shrinks total wall time by
 * roughly the same factor when Pyth's per-IP rate limit is the bottleneck.
 */
const maxCandlesPerPage = 9000;

/**
 * Pyth Benchmarks doesn't publish a documented rate limit and doesn't
 * include a Retry-After header in 429 responses. Direct probing shows
 * the limiter operates on a roughly 30-second rolling window: once you
 * trip it, subsequent requests 429 for ~30s and then start succeeding
 * again. So we start the backoff at 30s — anything shorter is wasted
 * since the window hasn't reset — and keep exponential growth + jitter
 * for the rare case where the limit doesn't clear on the first wait
 * (other clients hitting the same shared limit).
 */
const maxRateLimitRetries = 8;
const rateLimitInitialBackoffMs = 30_000;
const rateLimitMaxBackoffMs = 60_000;

/**
 * Pyth's TradingView shim occasionally hangs a request without responding.
 * Bun's default fetch timeout is generous (300s) and surfaces as a useless
 * empty-message error. Abort our own at 30s and treat it as a transient
 * failure — the same backoff path 429s use.
 */
const requestTimeoutMs = 30_000;

type FetchPythCandlesParams = {
  readonly asset: Asset;
  readonly timeframe: CandleTimeframe;
  readonly start: Date;
  readonly end: Date;
};

/**
 * Fetches Pyth Network oracle candles for `[start, end)` via the public
 * Benchmarks TradingView-compatible shim. No API key required.
 *
 * Pyth aggregates a median across ~10+ first-party publishers (Coinbase,
 * Cboe, Wintermute, Virtu, etc) — architecturally similar to Chainlink
 * Data Streams' reporter model, and a candidate proxy for the Streams
 * price Polymarket settles 5-minute markets on. See
 * scripts/source_vs_chainlink.ts for the comparison numbers.
 *
 * `volume` is always 0: Pyth is an oracle median, not a venue-level
 * trade tape.
 */
export async function fetchPythCandles({
  asset,
  timeframe,
  start,
  end,
}: FetchPythCandlesParams): Promise<readonly Candle[]> {
  const symbol = pythSymbol({ asset });
  const resolution = pythResolution({ timeframe });
  const barSec = barSecondsFor({ timeframe });
  const pageWindowSec = barSec * maxCandlesPerPage;
  const startSec = Math.floor(start.getTime() / 1000);
  const endSec = Math.ceil(end.getTime() / 1000);

  const accumulator: Candle[] = [];
  let nextStartSec = startSec;
  while (nextStartSec < endSec) {
    const pageEndSec = Math.min(nextStartSec + pageWindowSec, endSec);
    const url = new URL(baseUrl);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("resolution", resolution);
    url.searchParams.set("from", String(nextStartSec));
    url.searchParams.set("to", String(pageEndSec));

    const response = await fetchWithRateLimitRetry({
      url: url.toString(),
      symbol,
      timeframe,
      windowLabel: `${nextStartSec}..${pageEndSec}`,
    });
    const raw = await response.json();
    const status = headerSchema.parse(raw).s;
    if (status === "no_data") {
      nextStartSec = pageEndSec;
      continue;
    }
    if (status !== "ok") {
      throw new Error(
        `Pyth Benchmarks ${symbol} ${timeframe} returned status ${status}`,
      );
    }
    const parsed = okResponseSchema.parse(raw);

    for (let i = 0; i < parsed.t.length; i++) {
      const ts = parsed.t[i]!;
      if (ts < startSec || ts >= endSec) {
        continue;
      }
      // Drop bars whose timestamp doesn't land on the canonical
      // resolution boundary so off-grid rows can't pollute the
      // (source, asset, product, timeframe, timestamp) primary key.
      if (ts % barSec !== 0) {
        continue;
      }
      accumulator.push({
        source: "pyth",
        asset,
        product: "spot",
        timeframe,
        timestamp: new Date(ts * 1000),
        open: parsed.o[i]!,
        high: parsed.h[i]!,
        low: parsed.l[i]!,
        close: parsed.c[i]!,
        volume: 0,
      });
    }

    if (parsed.t.length === 0) {
      nextStartSec = pageEndSec;
    } else {
      // Advance past the last bar we received. If the server truncated
      // the response (returned fewer bars than the window holds), this
      // picks up where it left off; otherwise it lands at or just past
      // pageEndSec and the loop terminates.
      const lastTs = parsed.t[parsed.t.length - 1]!;
      nextStartSec = lastTs + barSec;
    }
  }

  accumulator.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  return accumulator;
}

function barSecondsFor({
  timeframe,
}: {
  readonly timeframe: CandleTimeframe;
}): number {
  switch (timeframe) {
    case "1m":
      return 60;
    case "5m":
      return 300;
    case "15m":
      return 900;
  }
}

async function fetchWithRateLimitRetry({
  url,
  symbol,
  timeframe,
  windowLabel,
}: {
  readonly url: string;
  readonly symbol: string;
  readonly timeframe: CandleTimeframe;
  readonly windowLabel: string;
}): Promise<Response> {
  for (let attempt = 0; attempt <= maxRateLimitRetries; attempt++) {
    let response: Response;
    try {
      response = await fetchWithTimeout(url);
    } catch (err) {
      // AbortError (timeout) or network error — treat as transient and
      // retry with the same backoff schedule a 429 uses.
      if (attempt < maxRateLimitRetries) {
        await sleepWithJitter({ attempt });
        continue;
      }
      throw new Error(
        `Pyth Benchmarks ${symbol} ${timeframe} (${windowLabel}) exhausted ${maxRateLimitRetries} retries; last error: ${(err as Error)?.message ?? String(err)}`,
      );
    }
    if (response.ok) {
      return response;
    }
    if (response.status === 429 && attempt < maxRateLimitRetries) {
      // Drain the body so the connection is reusable, then back off.
      await response.text();
      await sleepWithJitter({ attempt });
      continue;
    }
    const body = await response.text();
    throw new Error(
      `Pyth Benchmarks ${symbol} ${timeframe} (${windowLabel}) failed: ${response.status} ${body}`,
    );
  }
  throw new Error(
    `Pyth Benchmarks ${symbol} ${timeframe} (${windowLabel}) exhausted ${maxRateLimitRetries} retries`,
  );
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    return await fetch(url, {
      headers: { "User-Agent": "alea/1.0" },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function sleepWithJitter({
  attempt,
}: {
  readonly attempt: number;
}): Promise<void> {
  // Exponential growth capped at 60s, plus jitter up to half the base wait
  // so concurrent workers don't all retry on the same tick after the
  // rolling-window resets.
  const baseMs = Math.min(
    rateLimitInitialBackoffMs * 2 ** attempt,
    rateLimitMaxBackoffMs,
  );
  const totalMs = baseMs + Math.random() * (baseMs / 2);
  await new Promise((resolve) => setTimeout(resolve, totalMs));
}

const headerSchema = z.object({ s: z.string() }).passthrough();

const okResponseSchema = z
  .object({
    s: z.literal("ok"),
    t: z.array(z.number()),
    o: z.array(z.number()),
    h: z.array(z.number()),
    l: z.array(z.number()),
    c: z.array(z.number()),
    v: z.array(z.number()).optional(),
  })
  .passthrough();
