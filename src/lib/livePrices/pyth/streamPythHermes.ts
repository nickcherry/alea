import {
  assetForPythPriceFeedId,
  pythPriceFeedIds,
} from "@alea/lib/livePrices/pyth/pythPriceFeedIds";
import type { Asset } from "@alea/types/assets";
import { z } from "zod";

const hermesEndpoint = "https://hermes.pyth.network";

/**
 * Reconnect schedule. Pyth Hermes closes idle connections at 24h
 * regardless, and transient network blips happen — a small initial
 * backoff with a 30s cap keeps us responsive without hammering the
 * service when something's actually wrong.
 */
const initialBackoffMs = 1_000;
const maxBackoffMs = 30_000;

/**
 * If we go this long without an SSE event, force a reconnect. Pyth's
 * normal cadence is ~430ms (one Solana slot), so 15s of silence is a
 * strong signal the connection is half-open. The runtime SLA on
 * Hermes is on the order of seconds, not minutes — even with the most
 * pessimistic assumptions about publisher liveness, 15s is generous.
 */
const staleEventThresholdMs = 15_000;

export type PythTick = {
  readonly asset: Asset;
  readonly price: number;
  /**
   * Pyth's confidence interval, expressed in the same units as
   * `price`. Half the band where Pyth claims 1σ confidence the true
   * price falls. Not used by the trading logic today (we treat the
   * mid as a single point), but surfaced here for downstream
   * diagnostics.
   */
  readonly conf: number;
  /**
   * Publisher-side publish time in ms. Pyth's SSE payload reports
   * this in seconds; we multiply so all tick timestamps in the codebase
   * are in the same ms unit.
   */
  readonly publishTimeMs: number;
  readonly receivedAtMs: number;
};

export type StreamPythHermesParams = {
  readonly assets: readonly Asset[];
  readonly onTick: (tick: PythTick) => void;
  readonly onConnect?: () => void;
  readonly onDisconnect?: (reason: string) => void;
  readonly onError?: (error: Error) => void;
};

export type StreamPythHermesHandle = {
  readonly stop: () => Promise<void>;
};

/**
 * Subscribes to Pyth Hermes' SSE price stream for the requested
 * assets. Pyth has no venue-level BBO — the payload is a single
 * aggregate price per feed — so consumers should treat each tick as
 * `bid = ask = mid = price`.
 *
 * Reliability:
 * - Auto-reconnect with exponential backoff on any error or close.
 * - Stale-event watchdog (15s) covers the half-open case where the
 *   socket stays put but no events flow.
 * - Hermes voluntarily closes connections after 24h to bound
 *   resource use; we treat that the same as any other close —
 *   reconnect immediately.
 *
 * Topology: one SSE connection serves all subscribed assets. Pyth's
 * shim accepts a multi-id query (`ids[]=A&ids[]=B&...`) and
 * interleaves their updates onto the same stream, which is cheaper
 * than one socket per asset.
 */
export function streamPythHermes({
  assets,
  onTick,
  onConnect,
  onDisconnect,
  onError,
}: StreamPythHermesParams): StreamPythHermesHandle {
  if (assets.length === 0) {
    throw new Error("streamPythHermes: assets must not be empty");
  }
  const url = buildStreamUrl({ assets });

  let stopped = false;
  let attempt = 0;
  let abortController: AbortController | null = null;
  let staleTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const armStaleWatchdog = (): void => {
    if (staleTimer !== null) {
      clearTimeout(staleTimer);
    }
    staleTimer = setTimeout(() => {
      onDisconnect?.("stale-event-watchdog");
      abortController?.abort();
    }, staleEventThresholdMs);
  };
  const disarmStaleWatchdog = (): void => {
    if (staleTimer !== null) {
      clearTimeout(staleTimer);
      staleTimer = null;
    }
  };

  const scheduleReconnect = (): void => {
    if (stopped) {
      return;
    }
    const delayMs = Math.min(initialBackoffMs * 2 ** attempt, maxBackoffMs);
    attempt += 1;
    reconnectTimer = setTimeout(() => {
      void connect();
    }, delayMs);
  };

  const connect = async (): Promise<void> => {
    if (stopped) {
      return;
    }
    abortController = new AbortController();
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Accept: "text/event-stream" },
        signal: abortController.signal,
      });
    } catch (err) {
      if (!stopped) {
        onError?.(toError(err));
        scheduleReconnect();
      }
      return;
    }
    if (!response.ok || response.body === null) {
      onError?.(
        new Error(
          `pyth hermes stream HTTP ${response.status}: ${await response.text().catch(() => "")}`,
        ),
      );
      scheduleReconnect();
      return;
    }
    onConnect?.();
    attempt = 0;
    armStaleWatchdog();

    try {
      await consumeSseLines({
        body: response.body,
        onLine: (line) => {
          const ticks = parseSseLine({ line });
          if (ticks.length > 0) {
            armStaleWatchdog();
            for (const tick of ticks) {
              onTick(tick);
            }
          }
        },
      });
      // Body ended cleanly (e.g., the 24h close).
      onDisconnect?.("server-closed");
      disarmStaleWatchdog();
      scheduleReconnect();
    } catch (err) {
      disarmStaleWatchdog();
      if (!stopped) {
        onError?.(toError(err));
        onDisconnect?.((err as Error)?.message ?? "stream-error");
        scheduleReconnect();
      }
    }
  };

  void connect();

  return {
    stop: async () => {
      stopped = true;
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      disarmStaleWatchdog();
      abortController?.abort();
    },
  };
}

function buildStreamUrl({
  assets,
}: {
  readonly assets: readonly Asset[];
}): string {
  const u = new URL("/v2/updates/price/stream", hermesEndpoint);
  for (const asset of assets) {
    const id = pythPriceFeedIds[asset];
    if (id === undefined) {
      throw new Error(`pyth: no price feed id known for asset "${asset}"`);
    }
    u.searchParams.append("ids[]", id);
  }
  u.searchParams.set("parsed", "true");
  // We don't need the binary VAA on the wire — saves bytes per event.
  u.searchParams.set("encoding", "hex");
  return u.toString();
}

/**
 * Reads the SSE response body line-by-line, dispatching each `data:`
 * line through `onLine`. Discards comments, retry hints, and event
 * names — the Hermes endpoint only emits `data:`-prefixed events.
 */
async function consumeSseLines({
  body,
  onLine,
}: {
  readonly body: ReadableStream<Uint8Array>;
  readonly onLine: (line: string) => void;
}): Promise<void> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
        const rawLine = buffer.slice(0, newlineIdx);
        buffer = buffer.slice(newlineIdx + 1);
        const line = rawLine.replace(/\r$/, "");
        if (line.startsWith("data:")) {
          onLine(line.slice(5).trimStart());
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseSseLine({ line }: { readonly line: string }): PythTick[] {
  if (line.length === 0) {
    return [];
  }
  let payload: unknown;
  try {
    payload = JSON.parse(line);
  } catch {
    return [];
  }
  const parsed = streamEnvelopeSchema.safeParse(payload);
  if (!parsed.success || parsed.data.parsed === undefined) {
    return [];
  }
  // Hermes batches all subscribed feeds into one SSE event per
  // Solana slot. With 3 subscribed feeds the `parsed` array carries
  // 3 entries — emit a tick for each.
  const receivedAtMs = Date.now();
  const out: PythTick[] = [];
  for (const entry of parsed.data.parsed) {
    const asset = assetForPythPriceFeedId({ id: entry.id });
    if (asset === undefined) {
      continue;
    }
    const scale = 10 ** entry.price.expo;
    const priceNum = Number(entry.price.price);
    const confNum = Number(entry.price.conf);
    if (!Number.isFinite(priceNum) || !Number.isFinite(confNum)) {
      continue;
    }
    out.push({
      asset,
      price: priceNum * scale,
      conf: confNum * scale,
      publishTimeMs: entry.price.publish_time * 1000,
      receivedAtMs,
    });
  }
  return out;
}

function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }
  return new Error(String(value));
}

const priceSchema = z.object({
  price: z.string(),
  conf: z.string(),
  expo: z.number(),
  publish_time: z.number(),
});

const streamEnvelopeSchema = z
  .object({
    parsed: z
      .array(
        z
          .object({
            id: z.string(),
            price: priceSchema,
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();
