import { polymarket } from "@alea/constants/polymarket";
import { polymarketUpDownEventSlug } from "@alea/lib/polymarket/marketSlug";
import type { Asset } from "@alea/types/assets";
import type {
  ResolutionOutcome,
  ResolutionTimeframe,
} from "@alea/types/resolutions";
import { z } from "zod";

/**
 * Polymarket up/down crypto resolution row, parsed from the gamma-api
 * `/events?slug=...` payload. `outcome` is
 * derived from `outcomePrices`: `["1", "0"]` = up won, `["0", "1"]` =
 * down won; anything else (the rare void / refund case) becomes `void`.
 *
 * `resolvedAtMs` is best-effort from `closedTime` / `umaEndDate`. May be
 * `null` for legacy markets that lack both fields.
 */
export type PolymarketResolution = {
  readonly asset: Asset;
  readonly timeframe: ResolutionTimeframe;
  readonly windowStartTsMs: number;
  readonly conditionId: string;
  readonly outcome: ResolutionOutcome;
  readonly umaStatus: string;
  readonly resolvedAtMs: number | null;
};

/**
 * One of three things we expect from a slug lookup:
 *
 * - `resolved` — the market settled, we got an outcome
 * - `pending` — market exists but is still open / unresolved
 * - `missing` — slug returned an empty event list
 *
 * Sync skips `pending` so it can be re-fetched later. `missing` is
 * persisted as nothing — we treat it like a slot that never existed
 * (asset not listed at that time, or Polymarket retention pruned it).
 */
export type FetchResolutionResult =
  | { readonly kind: "resolved"; readonly resolution: PolymarketResolution }
  | { readonly kind: "pending" }
  | { readonly kind: "missing" };

const millisecondsPerSecond = 1000;

const requestTimeoutMs = 15_000;
const maxRetries = 5;
const initialBackoffMs = 1_000;
const maxBackoffMs = 30_000;

/**
 * Fetches one Polymarket up/down market resolution via the gamma-api.
 *
 * Single-slug lookups stay simple by design — no batching, no keyset
 * pagination — because the sync loop spreads concurrency across
 * windows. Each request retries transient errors (429 / 5xx / network)
 * with the same exponential-backoff shape `fetchPythCandles` uses.
 *
 * Returns:
 * - `resolved` with the canonical row when the market settled.
 * - `pending` when the market exists but is still open (or in dispute
 *   without a final `outcomePrices`).
 * - `missing` when the slug doesn't resolve to anything — the asset
 *   wasn't listed at that timestamp, or Polymarket pruned the row.
 */
export async function fetchPolymarketResolution({
  asset,
  timeframe,
  windowStartTsMs,
  signal,
}: {
  readonly asset: Asset;
  readonly timeframe: ResolutionTimeframe;
  readonly windowStartTsMs: number;
  readonly signal?: AbortSignal;
}): Promise<FetchResolutionResult> {
  const windowStartUnixSeconds = Math.floor(
    windowStartTsMs / millisecondsPerSecond,
  );
  const slug = polymarketUpDownEventSlug({
    asset,
    timeframe,
    windowStartUnixSeconds,
  });
  const url = `${polymarket.gammaApiUrl}/events?slug=${slug}`;

  const response = await fetchWithRetry({ url, slug, signal });
  const raw = await response.json();
  const parsed = eventListSchema.safeParse(raw);
  if (!parsed.success) {
    return { kind: "missing" };
  }
  const event = parsed.data[0];
  const market = event?.markets[0];
  if (event === undefined || market === undefined) {
    return { kind: "missing" };
  }

  const outcome = deriveOutcome({ outcomePrices: market.outcomePrices });
  if (outcome === null) {
    return { kind: "pending" };
  }

  return {
    kind: "resolved",
    resolution: {
      asset,
      timeframe,
      windowStartTsMs,
      conditionId: market.conditionId,
      outcome,
      umaStatus: market.umaResolutionStatus ?? "unknown",
      resolvedAtMs: parseTimestampMs({
        closedTime: market.closedTime,
        umaEndDate: market.umaEndDate,
      }),
    },
  };
}

/**
 * `outcomePrices` arrives JSON-encoded as a two-element string array,
 * one entry per outcome in the order Polymarket declares (`Up`, `Down`).
 * `"1"` means the side won, `"0"` means it lost; anything else (a
 * voided / refunded market keeps both at `"0"` or `"0.5"`) becomes
 * `void`. `null` means the market hasn't reported yet.
 */
function deriveOutcome({
  outcomePrices,
}: {
  readonly outcomePrices: string | undefined;
}): ResolutionOutcome | null {
  if (outcomePrices === undefined) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(outcomePrices);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) {
    return null;
  }
  const [up, down] = parsed;
  if (typeof up !== "string" || typeof down !== "string") {
    return null;
  }
  if (up === "1" && down === "0") {
    return "up";
  }
  if (up === "0" && down === "1") {
    return "down";
  }
  // Both legs at 0 or 0.5 indicates a void / refund: the market closed
  // without a winning direction.
  if ((up === "0" && down === "0") || (up === "0.5" && down === "0.5")) {
    return "void";
  }
  return null;
}

function parseTimestampMs({
  closedTime,
  umaEndDate,
}: {
  readonly closedTime: string | undefined;
  readonly umaEndDate: string | undefined;
}): number | null {
  for (const candidate of [closedTime, umaEndDate]) {
    if (candidate === undefined) {
      continue;
    }
    // `closedTime` comes back as `2026-05-10 17:35:17+00` (postgres-style),
    // which JS `Date` parses correctly. `umaEndDate` is ISO-8601.
    const ms = Date.parse(candidate);
    if (Number.isFinite(ms)) {
      return ms;
    }
  }
  return null;
}

async function fetchWithRetry({
  url,
  slug,
  signal,
}: {
  readonly url: string;
  readonly slug: string;
  readonly signal: AbortSignal | undefined;
}): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let response: Response;
    try {
      response = await fetchWithTimeout({ url, signal });
    } catch (err) {
      if (attempt < maxRetries) {
        await sleepWithJitter({ attempt });
        continue;
      }
      throw new Error(
        `gamma-api /events?slug=${slug} exhausted ${maxRetries} retries; last error: ${(err as Error)?.message ?? String(err)}`,
      );
    }
    if (response.ok) {
      return response;
    }
    if (
      attempt < maxRetries &&
      (response.status === 429 || response.status >= 500)
    ) {
      await response.text();
      await sleepWithJitter({ attempt });
      continue;
    }
    const body = await response.text();
    throw new Error(
      `gamma-api /events?slug=${slug} failed: ${response.status} ${body}`,
    );
  }
  throw new Error(
    `gamma-api /events?slug=${slug} exhausted ${maxRetries} retries`,
  );
}

async function fetchWithTimeout({
  url,
  signal,
}: {
  readonly url: string;
  readonly signal: AbortSignal | undefined;
}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  const onAbort = (): void => controller.abort();
  if (signal !== undefined) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  }
  try {
    return await fetch(url, {
      headers: { "User-Agent": "alea/1.0" },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
    if (signal !== undefined) {
      signal.removeEventListener("abort", onAbort);
    }
  }
}

async function sleepWithJitter({
  attempt,
}: {
  readonly attempt: number;
}): Promise<void> {
  const baseMs = Math.min(initialBackoffMs * 2 ** attempt, maxBackoffMs);
  const totalMs = baseMs + Math.random() * (baseMs / 2);
  await new Promise((resolve) => setTimeout(resolve, totalMs));
}

const marketSchema = z
  .object({
    conditionId: z.string(),
    outcomePrices: z.string().optional(),
    closedTime: z.string().optional(),
    umaEndDate: z.string().optional(),
    umaResolutionStatus: z.string().optional(),
  })
  .passthrough();

const eventSchema = z
  .object({ slug: z.string(), markets: z.array(marketSchema) })
  .passthrough();

const eventListSchema = z.array(eventSchema);
