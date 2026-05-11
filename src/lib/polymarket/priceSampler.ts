import type { DatabaseClient } from "@alea/lib/db/types";
import { resolutionTimeframeStepMs } from "@alea/lib/polymarket/enumerateWindowStarts";
import { discoverPolymarketMarket } from "@alea/lib/trading/vendor/polymarket/discoverMarket";
import { streamPolymarketMarketData } from "@alea/lib/trading/vendor/polymarket/streamMarketData";
import type {
  MarketDataEvent,
  MarketDataStreamHandle,
  PriceLevel,
  TradableMarket,
} from "@alea/lib/trading/vendor/types";
import type { Asset } from "@alea/types/assets";
import type { ResolutionTimeframe } from "@alea/types/resolutions";

const defaultSampleIntervalsMs = {
  "5m": 1_000,
  "15m": 3_000,
} as const satisfies Record<ResolutionTimeframe, number>;

const tickIntervalMs = 250;
const defaultDiscoveryLeadMs = 30_000;
const discoveryRequestIntervalMs = 750;
const missingMarketRetryMs = 15_000;
const discoveryFailureRetryMs = 10_000;
const rateLimitedDiscoveryRetryMs = 60_000;
const subscriptionTailMs = 10_000;
const sampleSchemaVersion = 1;

export type PriceSampleQuality = 0 | 1 | 2 | 3;

export type CompactPriceSample = readonly [
  offsetMs: number,
  upPriceBps: number,
  quality: PriceSampleQuality,
];

export type PriceSamplerLogEvent = {
  readonly kind: "info" | "warn" | "error";
  readonly atMs: number;
  readonly message: string;
  readonly persistedMarket?: {
    readonly asset: Asset;
    readonly timeframe: ResolutionTimeframe;
    readonly windowStartTsMs: number;
    readonly sampleCount: number;
    readonly missingSampleCount: number;
  };
};

export type RunPolymarketPriceSamplerParams = {
  readonly db: DatabaseClient;
  readonly assets: readonly Asset[];
  readonly timeframes: readonly ResolutionTimeframe[];
  readonly signal: AbortSignal;
  readonly sampleIntervalsMs?: Partial<Record<ResolutionTimeframe, number>>;
  readonly discoveryLeadMs?: number;
  readonly log?: (event: PriceSamplerLogEvent) => void;
};

type TokenPriceState = {
  bid: number | null;
  ask: number | null;
  last: number | null;
};

export type MarketPriceState = {
  up: TokenPriceState;
  down: TokenPriceState;
};

type SamplerMarketSession = {
  readonly key: string;
  readonly asset: Asset;
  readonly timeframe: ResolutionTimeframe;
  readonly windowStartTsMs: number;
  readonly windowEndTsMs: number;
  readonly market: TradableMarket;
  readonly sampleIntervalMs: number;
  readonly state: MarketPriceState;
  readonly samples: CompactPriceSample[];
  nextSampleAtMs: number;
  firstSampleTsMs: number | null;
  lastSampleTsMs: number | null;
  missingSampleCount: number;
  finalizing: boolean;
};

type TokenRoute = {
  readonly state: MarketPriceState;
  readonly side: "up" | "down";
};

type DiscoveryRequest = {
  readonly key: string;
  readonly asset: Asset;
  readonly timeframe: ResolutionTimeframe;
  readonly windowStartTsMs: number;
};

export async function runPolymarketPriceSampler({
  db,
  assets,
  timeframes,
  signal,
  sampleIntervalsMs = {},
  discoveryLeadMs = defaultDiscoveryLeadMs,
  log,
}: RunPolymarketPriceSamplerParams): Promise<void> {
  const sessions = new Map<string, SamplerMarketSession>();
  const inflightDiscoveries = new Set<string>();
  const queuedDiscoveries = new Set<string>();
  const nextDiscoveryAttemptMs = new Map<string, number>();
  const discoveryQueue: DiscoveryRequest[] = [];
  const tokenRoutes = new Map<string, TokenRoute>();
  let streamHandle: MarketDataStreamHandle | null = null;
  let discoveryPumpTimer: ReturnType<typeof setTimeout> | null = null;
  let activeDiscoveryCount = 0;
  let lastDiscoveryStartedAtMs = 0;
  let tickRunning = false;

  const emit = (event: Omit<PriceSamplerLogEvent, "atMs">): void => {
    log?.({ ...event, atMs: Date.now() });
  };

  const rebuildSubscription = (): void => {
    const markets: TradableMarket[] = [];
    tokenRoutes.clear();

    const nowMs = Date.now();
    for (const session of sessions.values()) {
      if (session.windowEndTsMs + subscriptionTailMs < nowMs) {
        continue;
      }
      markets.push(session.market);
      tokenRoutes.set(session.market.upRef, {
        state: session.state,
        side: "up",
      });
      tokenRoutes.set(session.market.downRef, {
        state: session.state,
        side: "down",
      });
    }

    if (streamHandle !== null) {
      void streamHandle.stop();
      streamHandle = null;
    }
    if (markets.length === 0) {
      return;
    }

    emit({
      kind: "info",
      message: `subscribing polymarket price sampler to ${markets.length} markets`,
    });
    streamHandle = streamPolymarketMarketData({
      markets,
      onEvent: (event) => {
        applyMarketDataEventToSamplerState({ event, tokenRoutes });
      },
      onConnect: () => {
        emit({
          kind: "info",
          message: "polymarket price sampler WS connected",
        });
      },
      onDisconnect: (reason) => {
        emit({
          kind: "warn",
          message: `polymarket price sampler WS disconnected: ${reason}`,
        });
      },
      onError: (error) => {
        emit({
          kind: "error",
          message: `polymarket price sampler WS error: ${error.message}`,
        });
      },
    });
  };

  const clearDiscoveryPumpTimer = (): void => {
    if (discoveryPumpTimer !== null) {
      clearTimeout(discoveryPumpTimer);
      discoveryPumpTimer = null;
    }
  };

  const pumpDiscoveryQueue = (): void => {
    if (signal.aborted || activeDiscoveryCount > 0) {
      return;
    }
    const nowMs = Date.now();
    const waitMs =
      lastDiscoveryStartedAtMs + discoveryRequestIntervalMs - nowMs;
    if (waitMs > 0) {
      if (discoveryPumpTimer === null) {
        discoveryPumpTimer = setTimeout(() => {
          discoveryPumpTimer = null;
          pumpDiscoveryQueue();
        }, waitMs);
      }
      return;
    }

    const request = discoveryQueue.shift();
    if (request === undefined) {
      return;
    }
    queuedDiscoveries.delete(request.key);
    if (
      sessions.has(request.key) ||
      inflightDiscoveries.has(request.key) ||
      (nextDiscoveryAttemptMs.get(request.key) ?? 0) > nowMs
    ) {
      pumpDiscoveryQueue();
      return;
    }

    activeDiscoveryCount += 1;
    inflightDiscoveries.add(request.key);
    lastDiscoveryStartedAtMs = nowMs;
    void discoverPolymarketMarket({
      asset: request.asset,
      timeframe: request.timeframe,
      windowStartUnixSeconds: Math.floor(request.windowStartTsMs / 1_000),
      signal,
    })
      .then((market) => {
        if (market === null || signal.aborted) {
          nextDiscoveryAttemptMs.set(
            request.key,
            Date.now() + missingMarketRetryMs,
          );
          return;
        }
        nextDiscoveryAttemptMs.delete(request.key);
        const stepMs = resolutionTimeframeStepMs({
          timeframe: request.timeframe,
        });
        const intervalMs =
          sampleIntervalsMs[request.timeframe] ??
          defaultSampleIntervalsMs[request.timeframe];
        sessions.set(request.key, {
          key: request.key,
          asset: request.asset,
          timeframe: request.timeframe,
          windowStartTsMs: request.windowStartTsMs,
          windowEndTsMs: request.windowStartTsMs + stepMs,
          market,
          sampleIntervalMs: intervalMs,
          state: emptyMarketPriceState(),
          samples: [],
          nextSampleAtMs: Math.max(Date.now(), request.windowStartTsMs),
          firstSampleTsMs: null,
          lastSampleTsMs: null,
          missingSampleCount: 0,
          finalizing: false,
        });
        emit({
          kind: "info",
          message: `discovered ${request.asset.toUpperCase()} ${request.timeframe} market ${new Date(request.windowStartTsMs).toISOString()}`,
        });
        rebuildSubscription();
      })
      .catch((error) => {
        const message = sanitizeErrorMessage(error);
        const retryMs = isRateLimitedMessage(message)
          ? rateLimitedDiscoveryRetryMs
          : discoveryFailureRetryMs;
        nextDiscoveryAttemptMs.set(request.key, Date.now() + retryMs);
        emit({
          kind: "warn",
          message:
            `discover ${request.asset.toUpperCase()} ${request.timeframe} ` +
            `${new Date(request.windowStartTsMs).toISOString()} failed; ` +
            `retry_in=${formatMs(retryMs)}: ${message}`,
        });
      })
      .finally(() => {
        activeDiscoveryCount -= 1;
        inflightDiscoveries.delete(request.key);
        pumpDiscoveryQueue();
      });
  };

  const queueDiscovery = ({
    asset,
    timeframe,
    windowStartTsMs,
  }: {
    readonly asset: Asset;
    readonly timeframe: ResolutionTimeframe;
    readonly windowStartTsMs: number;
  }): void => {
    const key = marketKey({ asset, timeframe, windowStartTsMs });
    if (
      sessions.has(key) ||
      inflightDiscoveries.has(key) ||
      queuedDiscoveries.has(key)
    ) {
      return;
    }
    const nowMs = Date.now();
    if ((nextDiscoveryAttemptMs.get(key) ?? 0) > nowMs) {
      return;
    }
    queuedDiscoveries.add(key);
    discoveryQueue.push({ key, asset, timeframe, windowStartTsMs });
    pumpDiscoveryQueue();
  };

  const tick = async (): Promise<void> => {
    if (tickRunning || signal.aborted) {
      return;
    }
    tickRunning = true;
    try {
      const nowMs = Date.now();
      for (const timeframe of timeframes) {
        const stepMs = resolutionTimeframeStepMs({ timeframe });
        const currentStart = currentWindowStartMs({ nowMs, stepMs });
        const nextStart = currentStart + stepMs;
        for (const asset of assets) {
          queueDiscovery({ asset, timeframe, windowStartTsMs: currentStart });
          if (nowMs + discoveryLeadMs >= nextStart) {
            queueDiscovery({ asset, timeframe, windowStartTsMs: nextStart });
          }
        }
      }
      sampleActiveSessions({ sessions, nowMs });
      const finalizedCount = await finalizeEndedSessions({
        db,
        sessions,
        nowMs,
        emit,
      });
      if (finalizedCount > 0) {
        rebuildSubscription();
      }
    } finally {
      tickRunning = false;
    }
  };

  emit({
    kind: "info",
    message: `price sampler starting assets=${assets.join(",")} timeframes=${timeframes.join(",")}`,
  });
  await tick();
  const tickHandle = setInterval(() => {
    void tick();
  }, tickIntervalMs);

  await waitForSignal(signal);

  clearInterval(tickHandle);
  clearDiscoveryPumpTimer();
  emit({
    kind: "info",
    message: "shutdown signal received; closing price sampler",
  });
  const handle = streamHandle as MarketDataStreamHandle | null;
  if (handle !== null) {
    await handle.stop();
  }
  streamHandle = null;
  emit({ kind: "info", message: "price sampler stopped cleanly" });
}

export function applyMarketDataEventToSamplerState({
  event,
  tokenRoutes,
}: {
  readonly event: MarketDataEvent;
  readonly tokenRoutes: ReadonlyMap<string, TokenRoute>;
}): void {
  if (event.kind === "resolved") {
    return;
  }
  if (event.outcomeRef === null) {
    return;
  }
  const route = tokenRoutes.get(event.outcomeRef);
  if (route === undefined) {
    return;
  }
  const token = route.side === "up" ? route.state.up : route.state.down;
  switch (event.kind) {
    case "book":
      token.bid = bestBid(event.bids);
      token.ask = bestAsk(event.asks);
      break;
    case "best-bid-ask":
      token.bid = normalizePrice(event.bestBid);
      token.ask = normalizePrice(event.bestAsk);
      break;
    case "price-change":
    case "trade":
      token.last = normalizePrice(event.price);
      break;
    case "tick-size-change":
      break;
  }
}

export function sampleNormalizedUpPrice({
  state,
}: {
  readonly state: MarketPriceState;
}): { readonly price: number; readonly quality: PriceSampleQuality } | null {
  const upMid = midPrice(state.up);
  if (upMid !== null) {
    return { price: upMid, quality: 0 };
  }
  const downMid = midPrice(state.down);
  if (downMid !== null) {
    return { price: 1 - downMid, quality: 1 };
  }
  if (state.up.last !== null) {
    return { price: state.up.last, quality: 2 };
  }
  if (state.down.last !== null) {
    return { price: 1 - state.down.last, quality: 3 };
  }
  return null;
}

function sampleActiveSessions({
  sessions,
  nowMs,
}: {
  readonly sessions: ReadonlyMap<string, SamplerMarketSession>;
  readonly nowMs: number;
}): void {
  for (const session of sessions.values()) {
    if (
      nowMs < session.windowStartTsMs ||
      nowMs >= session.windowEndTsMs ||
      nowMs < session.nextSampleAtMs
    ) {
      continue;
    }
    session.nextSampleAtMs = nowMs + session.sampleIntervalMs;
    const sample = sampleNormalizedUpPrice({ state: session.state });
    if (sample === null) {
      session.missingSampleCount += 1;
      return;
    }
    const sampleTsMs = nowMs;
    const offsetMs = Math.max(0, sampleTsMs - session.windowStartTsMs);
    session.samples.push([offsetMs, priceToBps(sample.price), sample.quality]);
    session.firstSampleTsMs ??= sampleTsMs;
    session.lastSampleTsMs = sampleTsMs;
  }
}

async function finalizeEndedSessions({
  db,
  sessions,
  nowMs,
  emit,
}: {
  readonly db: DatabaseClient;
  readonly sessions: Map<string, SamplerMarketSession>;
  readonly nowMs: number;
  readonly emit: (event: Omit<PriceSamplerLogEvent, "atMs">) => void;
}): Promise<number> {
  let finalizedCount = 0;
  for (const session of sessions.values()) {
    if (session.finalizing || nowMs < session.windowEndTsMs) {
      continue;
    }
    session.finalizing = true;
    try {
      await persistSession({ db, session, finalizedAtMs: nowMs });
      sessions.delete(session.key);
      finalizedCount += 1;
      emit({
        kind: "info",
        message:
          `persisted ${session.asset.toUpperCase()} ${session.timeframe} ` +
          `${new Date(session.windowStartTsMs).toISOString()} samples=${session.samples.length} missing=${session.missingSampleCount}`,
        persistedMarket: {
          asset: session.asset,
          timeframe: session.timeframe,
          windowStartTsMs: session.windowStartTsMs,
          sampleCount: session.samples.length,
          missingSampleCount: session.missingSampleCount,
        },
      });
    } catch (error) {
      session.finalizing = false;
      emit({
        kind: "error",
        message:
          `persist ${session.asset.toUpperCase()} ${session.timeframe} ` +
          `${new Date(session.windowStartTsMs).toISOString()} failed: ${(error as Error).message}`,
      });
    }
  }
  return finalizedCount;
}

async function persistSession({
  db,
  session,
  finalizedAtMs,
}: {
  readonly db: DatabaseClient;
  readonly session: SamplerMarketSession;
  readonly finalizedAtMs: number;
}): Promise<void> {
  const row = {
    asset: session.asset,
    timeframe: session.timeframe,
    window_start_ts_ms: session.windowStartTsMs,
    window_end_ts_ms: session.windowEndTsMs,
    condition_id: session.market.vendorRef,
    up_token_id: session.market.upRef,
    down_token_id: session.market.downRef,
    schema_version: sampleSchemaVersion,
    sample_interval_ms: session.sampleIntervalMs,
    first_sample_ts_ms: session.firstSampleTsMs,
    last_sample_ts_ms: session.lastSampleTsMs,
    finalized_at_ms: finalizedAtMs,
    sample_count: session.samples.length,
    missing_sample_count: session.missingSampleCount,
    samples: JSON.stringify(session.samples) as unknown,
  };
  await db
    .insertInto("polymarket_price_samples")
    .values(row)
    .onConflict((oc) =>
      oc.columns(["asset", "timeframe", "window_start_ts_ms"]).doUpdateSet(row),
    )
    .execute();
}

function emptyMarketPriceState(): MarketPriceState {
  return {
    up: { bid: null, ask: null, last: null },
    down: { bid: null, ask: null, last: null },
  };
}

function currentWindowStartMs({
  nowMs,
  stepMs,
}: {
  readonly nowMs: number;
  readonly stepMs: number;
}): number {
  return Math.floor(nowMs / stepMs) * stepMs;
}

function marketKey({
  asset,
  timeframe,
  windowStartTsMs,
}: {
  readonly asset: Asset;
  readonly timeframe: ResolutionTimeframe;
  readonly windowStartTsMs: number;
}): string {
  return `${asset}:${timeframe}:${windowStartTsMs}`;
}

function bestBid(levels: readonly PriceLevel[]): number | null {
  let best: number | null = null;
  for (const level of levels) {
    const price = normalizePrice(level.price);
    if (price === null) {
      continue;
    }
    if (best === null || price > best) {
      best = price;
    }
  }
  return best;
}

function bestAsk(levels: readonly PriceLevel[]): number | null {
  let best: number | null = null;
  for (const level of levels) {
    const price = normalizePrice(level.price);
    if (price === null) {
      continue;
    }
    if (best === null || price < best) {
      best = price;
    }
  }
  return best;
}

function midPrice(state: TokenPriceState): number | null {
  if (state.bid === null || state.ask === null || state.ask < state.bid) {
    return null;
  }
  return (state.bid + state.ask) / 2;
}

function normalizePrice(value: number | null): number | null {
  if (value === null || !Number.isFinite(value) || value < 0 || value > 1) {
    return null;
  }
  return value;
}

function priceToBps(price: number): number {
  return Math.max(0, Math.min(10_000, Math.round(price * 10_000)));
}

function sanitizeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (collapsed.length <= 240) {
    return collapsed;
  }
  return `${collapsed.slice(0, 240)}...`;
}

function isRateLimitedMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("1015") ||
    lower.includes("rate limit") ||
    lower.includes("429")
  );
}

function formatMs(ms: number): string {
  if (ms < 1_000) {
    return `${ms}ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1_000).toFixed(1)}s`;
  }
  return `${Math.round(ms / 60_000)}m`;
}

function waitForSignal(signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}
