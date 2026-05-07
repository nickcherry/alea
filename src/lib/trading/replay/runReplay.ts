import { trainingCandleSeries } from "@alea/constants/training";
import { STAKE_USD } from "@alea/constants/trading";
import type { DatabaseClient } from "@alea/lib/db/types";
import {
  FIVE_MINUTES_MS,
  currentWindowStartMs,
} from "@alea/lib/livePrices/fiveMinuteWindow";
import {
  createRegimeTrackers,
  type RegimeTrackers,
} from "@alea/lib/livePrices/regimeTrackers";
import type { ClosedFiveMinuteBar } from "@alea/lib/livePrices/types";
import {
  computeDryAggregateMetrics,
  type DryAggregateMetrics,
  type DryOrderResolution,
} from "@alea/lib/trading/dryRun/metrics";
import { buildReplayMarketManifest } from "@alea/lib/trading/replay/derivedMarkets";
import {
  createReplayJsonlWriter,
  type ReplayJsonlWriter,
} from "@alea/lib/trading/replay/jsonlLog";
import { loadMarketEvents } from "@alea/lib/trading/replay/loadMarketEvents";
import {
  buildLeadTimeForOrder,
  replayWindow,
  type ReplayAssetResult,
  type ReplayOrderEnvelope,
} from "@alea/lib/trading/replay/replayWindow";
import {
  bucketChainlinkByAsset,
  type ChainlinkOutcome,
} from "@alea/lib/trading/replay/resolveWindowOutcome";
import type {
  ReplayChainlinkRefPriceEvent,
  ReplayEvent,
  ReplayRunEvent,
  ReplayTickSource,
} from "@alea/lib/trading/replay/types";
import { loadTrainingCandles } from "@alea/lib/training/loadTrainingCandles";
import type { ProbabilityTable } from "@alea/lib/trading/types";
import type { Asset } from "@alea/types/assets";

const TRACKER_BOOTSTRAP_BARS = 70;
const PRELUDE_MS = 5_000;
const POSTLUDE_MS = 30_000;
/**
 * Polymarket up/down 5m markets resolve ~1–2 minutes after window
 * end. The manifest pass needs the resolved event for each requested
 * window to derive up/down, so its load range extends well past the
 * caller's `toMs`. Five minutes covers the observed resolution lag
 * with comfortable margin.
 */
const MANIFEST_RESOLUTION_TAIL_MS = 5 * 60 * 1_000;

export type RunReplayParams = {
  readonly db: DatabaseClient;
  readonly assets: readonly Asset[];
  readonly fromMs: number;
  readonly toMs: number;
  readonly table: ProbabilityTable;
  readonly minEdge: number;
  readonly stakeUsd?: number;
  readonly logWriter?: ReplayJsonlWriter;
  readonly emit: (event: ReplayRunEvent) => void;
  readonly signal: AbortSignal;
  /**
   * Override the (source, product) used to bootstrap the regime
   * trackers. Defaults to the canonical training series in
   * `trainingCandleSeries`. Mostly useful when running head-to-head
   * comparisons against a probability table trained on a different
   * venue/product.
   */
  readonly candleSource?: "binance" | "coinbase";
  readonly candleProduct?: "spot" | "perp";
  /**
   * Which captured BBO stream the per-window driver consumes as its
   * `lastTick` / line-capture source. Defaults to `binance-perp` to
   * match the live trader.
   */
  readonly tickSource?: ReplayTickSource;
  /**
   * Cancel a placed order if the underlying tick mid moves against
   * our predicted side by ≥ N basis points after placement. 0 = no
   * cancellation (current behaviour). See `replayWindow.ts` for the
   * exact rule.
   */
  readonly cancelOnAdverseBp?: number;
};

export type RunReplayResult = {
  readonly logPath: string;
  readonly windowsProcessed: number;
  readonly windowsSkipped: number;
  readonly sessionMetrics: DryAggregateMetrics;
};

/**
 * Top-level replay orchestrator. Walks every captured 5-minute window
 * in `[fromMs, toMs]` in chronological order, reproduces the live
 * trader's per-asset decision + placement + fill behaviour against
 * the captured tape, and emits the same JSONL shape `runDryRun`
 * does — so the existing dashboard renderer works on the replay
 * output unchanged.
 *
 * Two database passes:
 *   1. Manifest: stream every polymarket event in the range to
 *      derive the (asset, windowStart) → market mapping (up/down
 *      assignment from the captured `resolved` events).
 *   2. Per-window replay: for each window in the manifest, query
 *      that window's binance + polymarket events plus the asset's
 *      chainlink reference-price slice, hydrate the regime trackers
 *      from the candles table, then call `replayWindow`.
 *
 * Chainlink events are pre-loaded into memory once across the whole
 * range (~5 events/sec/asset is small even for multi-day replays).
 *
 * Errors during outcome resolution (missing chainlink coverage)
 * exclude the offending (asset, window) from session metrics but do
 * NOT abort the run — a deliberate choice so a single bad window
 * doesn't blow away a multi-day replay's results.
 */
export async function runReplay({
  db,
  assets,
  fromMs,
  toMs,
  table,
  minEdge,
  stakeUsd = STAKE_USD,
  logWriter,
  emit,
  signal,
  candleSource,
  candleProduct,
  tickSource = defaultTickSourceFromTrainingSeries(),
  cancelOnAdverseBp = 0,
}: RunReplayParams): Promise<RunReplayResult> {
  const writer = logWriter ?? (await createReplayJsonlWriter());
  emit({
    kind: "info",
    atMs: Date.now(),
    message: `replay starting: ${new Date(fromMs).toISOString()} → ${new Date(toMs).toISOString()}, assets=${assets.join(",")}, stake=$${stakeUsd}, minEdge=${minEdge.toFixed(3)}, log=${writer.path}`,
  });

  await writer.append({
    type: "session_start",
    atMs: Date.now(),
    config: {
      vendor: "polymarket-replay",
      priceSource: `${tickSource}-replay`,
      assets,
      minEdge,
      stakeUsd,
      tableRange: formatTableRange({ table }),
      telegramAlerts: false,
      replay: {
        fromMs,
        toMs,
      },
    },
  });

  // Pass 1: manifest scan.
  emit({
    kind: "info",
    atMs: Date.now(),
    message: "pass 1/2: scanning polymarket events to derive market manifest",
  });
  const manifestLoad = loadMarketEvents({
    db,
    fromMs: fromMs - PRELUDE_MS,
    toMs: toMs + MANIFEST_RESOLUTION_TAIL_MS,
    assets,
    sources: ["polymarket"],
    // Manifest only needs `resolved` events (for up/down assignment +
    // windowStart anchoring) plus `best-bid-ask` to discover the two
    // tokenIds per market. Skipping `book` (~9.5 GB of L2 depth in
    // payloads) and `trade` (~1.5M extra rows) drops manifest cost ~6×.
    kinds: ["resolved", "best-bid-ask"],
  });
  const manifest = await buildReplayMarketManifest({
    events: manifestLoad.events,
  });
  emit({
    kind: "info",
    atMs: Date.now(),
    message: `manifest: ${countMarkets({ manifest })} markets across ${manifest.byWindow.size} windows; skipped=${manifest.skipped.length}; rowsScanned=${manifestLoad.stats.rowsScanned}`,
  });
  for (const skipped of manifest.skipped) {
    emit({
      kind: "warn",
      atMs: Date.now(),
      message: `manifest skip: ${skipped.asset ?? "?"}@${new Date(skipped.windowStartMs).toISOString()} ${skipped.vendorRef.slice(0, 12)}… — ${skipped.reason}`,
    });
  }
  if (signal.aborted) {
    return abortResult({ writer, sessionMetrics: emptyMetrics(), windowsProcessed: 0, windowsSkipped: 0, emit });
  }

  // Chainlink slice (pre-loaded once for the whole range; the per-
  // window driver indexes into it).
  emit({
    kind: "info",
    atMs: Date.now(),
    message: "loading chainlink reference-price slice",
  });
  const chainlinkLoad = loadMarketEvents({
    db,
    fromMs: fromMs - FIVE_MINUTES_MS,
    toMs: toMs + FIVE_MINUTES_MS,
    assets,
    sources: ["polymarket-chainlink"],
  });
  const chainlinkEvents: ReplayChainlinkRefPriceEvent[] = [];
  for await (const event of chainlinkLoad.events) {
    if (
      event.source === "polymarket-chainlink" &&
      event.kind === "reference-price"
    ) {
      chainlinkEvents.push(event);
    }
  }
  const chainlinkByAsset = bucketChainlinkByAsset({ events: chainlinkEvents });
  emit({
    kind: "info",
    atMs: Date.now(),
    message: `chainlink: ${chainlinkEvents.length} events across ${chainlinkByAsset.size} assets`,
  });

  // Bootstrap candles for trackers (one query per asset).
  emit({
    kind: "info",
    atMs: Date.now(),
    message: "loading bootstrap candles for regime trackers",
  });
  const candlesByAsset = new Map<Asset, readonly ClosedFiveMinuteBar[]>();
  for (const asset of assets) {
    const candles = await loadTrainingCandles({
      db,
      asset,
      ...(candleSource !== undefined ? { source: candleSource } : {}),
      ...(candleProduct !== undefined ? { product: candleProduct } : {}),
    });
    candlesByAsset.set(
      asset,
      candles.map((candle) => ({
        asset,
        openTimeMs: candle.timestamp.getTime(),
        closeTimeMs: candle.timestamp.getTime() + FIVE_MINUTES_MS,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      })),
    );
  }
  for (const asset of assets) {
    const c = candlesByAsset.get(asset) ?? [];
    emit({
      kind: "info",
      atMs: Date.now(),
      message: `${asset}: ${c.length} candle bars loaded for tracker bootstrap`,
    });
  }

  // Pass 2: per-window replay.
  const windowStarts = [...manifest.byWindow.keys()]
    .filter(
      (windowStart) =>
        windowStart >= currentWindowStartMs({ nowMs: fromMs }) &&
        windowStart < toMs,
    )
    .sort((a, b) => a - b);

  emit({
    kind: "info",
    atMs: Date.now(),
    message: `pass 2/2: replaying ${windowStarts.length} windows`,
  });

  const sessionResolutions: DryOrderResolution[] = [];
  let windowsProcessed = 0;
  let windowsSkipped = 0;

  for (const windowStartMs of windowStarts) {
    if (signal.aborted) {
      break;
    }
    const windowEndMs = windowStartMs + FIVE_MINUTES_MS;
    const windowMarkets = manifest.byWindow.get(windowStartMs);
    if (windowMarkets === undefined || windowMarkets.size === 0) {
      windowsSkipped += 1;
      continue;
    }

    // Hydrate per-asset trackers from candles. Candles are already
    // sorted ascending by openTimeMs (the loader returns them in DB
    // order); binary-search for the cutoff and slice the trailing
    // bootstrap window. O(log N) per asset per window vs the prior
    // O(N) full-array filter, which dominated multi-day replays.
    const trackers = new Map<Asset, RegimeTrackers>();
    for (const asset of assets) {
      const tracker = createRegimeTrackers();
      const bars = candlesByAsset.get(asset) ?? [];
      const cutoffIdx = upperBoundOpenTime({ bars, lessThanMs: windowStartMs });
      const sliceStart = Math.max(0, cutoffIdx - TRACKER_BOOTSTRAP_BARS);
      for (let i = sliceStart; i < cutoffIdx; i += 1) {
        const bar = bars[i];
        if (bar !== undefined) {
          tracker.append(bar);
        }
      }
      trackers.set(asset, tracker);
    }

    // Pull events for this window. We only need polymarket book/
    // trade/bba events plus the configured tick source's BBO; skip
    // every other captured venue to keep the per-window query narrow.
    const eventsLoad = loadMarketEvents({
      db,
      fromMs: windowStartMs - PRELUDE_MS,
      toMs: windowEndMs + POSTLUDE_MS,
      assets,
      sources: ["polymarket", tickSource],
    });
    const events: ReplayEvent[] = [];
    for await (const event of eventsLoad.events) {
      if (event.source === tickSource || event.source === "polymarket") {
        events.push(event);
      }
    }

    // Subset chainlink to a generous window slice for resolution.
    const sliceStart = windowStartMs - FIVE_MINUTES_MS;
    const sliceEnd = windowEndMs + FIVE_MINUTES_MS;
    const chainlinkSliceByAsset = new Map<
      Asset,
      readonly ReplayChainlinkRefPriceEvent[]
    >();
    for (const [asset, full] of chainlinkByAsset) {
      chainlinkSliceByAsset.set(
        asset,
        full.filter(
          (event) => event.tsMs >= sliceStart && event.tsMs <= sliceEnd,
        ),
      );
    }

    const result = replayWindow({
      windowStartMs,
      markets: windowMarkets,
      events,
      chainlinkByAsset: chainlinkSliceByAsset,
      trackers,
      table,
      minEdge,
      stakeUsd,
      tickSource,
      cancelOnAdverseBp,
      emit: (event) => {
        emit(event);
        // Forward to JSONL writer for events that are part of the
        // session ledger. We also persist the synchronously-built
        // virtual_order so a later report can render it without
        // waiting for window finalize.
        if (event.kind === "virtual-order") {
          // Capture telemetry by serializing the envelope at finalize
          // (it's not yet built here). Skipping per-event JSONL
          // emission keeps the writer order consistent.
        }
      },
    });

    // Per-window resolutions (only assets with both an order AND a
    // chainlink-derived outcome contribute to PnL aggregates).
    const windowResolutions: DryOrderResolution[] = [];
    for (const [, assetResult] of result.perAsset) {
      const envelope = assetResult.orderEnvelope;
      const outcome = assetResult.outcome;
      if (envelope === null) {
        continue;
      }
      if (outcome === null) {
        emit({
          kind: "warn",
          atMs: Date.now(),
          message: `${assetResult.asset}@${new Date(windowStartMs).toISOString()}: order placed but outcome unresolvable (${assetResult.outcomeError?.kind ?? "unknown"}) — excluding from PnL`,
        });
        continue;
      }
      windowResolutions.push({
        order: envelope.order,
        officialWinningSide: outcome.winningSide,
        proxyWinningSide: outcome.polymarketResolution?.winningSide ?? null,
      });
    }
    const windowMetrics = computeDryAggregateMetrics({
      resolutions: windowResolutions,
    });
    sessionResolutions.push(...windowResolutions);
    const sessionMetrics = computeDryAggregateMetrics({
      resolutions: sessionResolutions,
    });

    const orders = serializeWindowOrders({ result });
    await writer.append({
      type: "window_finalized",
      atMs: Date.now(),
      windowStartMs,
      windowEndMs,
      orders,
      metrics: { window: windowMetrics, session: sessionMetrics },
      summary: summarizeWindow({
        windowStartMs,
        windowMetrics,
        sessionMetrics,
      }),
      replayChainlink: serializeWindowChainlink({ result }),
    });

    emit({
      kind: "window-finalized",
      atMs: Date.now(),
      windowStartMs,
      windowEndMs,
      metrics: windowMetrics,
      sessionMetrics,
      body: summarizeWindow({
        windowStartMs,
        windowMetrics,
        sessionMetrics,
      }),
    });
    windowsProcessed += 1;
  }

  const sessionMetrics = computeDryAggregateMetrics({
    resolutions: sessionResolutions,
  });
  await writer.append({
    type: "session_stop",
    atMs: Date.now(),
    summary: {
      windowsProcessed,
      windowsSkipped,
      sessionMetrics,
    },
  });
  emit({
    kind: "info",
    atMs: Date.now(),
    message: `replay complete: windows=${windowsProcessed} skipped=${windowsSkipped} canonicalPnl=$${sessionMetrics.canonical.pnlUsd.toFixed(2)}`,
  });

  return {
    logPath: writer.path,
    windowsProcessed,
    windowsSkipped,
    sessionMetrics,
  };
}

function abortResult({
  writer,
  sessionMetrics,
  windowsProcessed,
  windowsSkipped,
  emit,
}: {
  readonly writer: ReplayJsonlWriter;
  readonly sessionMetrics: DryAggregateMetrics;
  readonly windowsProcessed: number;
  readonly windowsSkipped: number;
  readonly emit: (event: ReplayRunEvent) => void;
}): RunReplayResult {
  emit({
    kind: "warn",
    atMs: Date.now(),
    message: "replay aborted before completion",
  });
  return {
    logPath: writer.path,
    windowsProcessed,
    windowsSkipped,
    sessionMetrics,
  };
}

function emptyMetrics(): DryAggregateMetrics {
  return computeDryAggregateMetrics({ resolutions: [] });
}

function countMarkets({
  manifest,
}: {
  readonly manifest: { readonly byWindow: ReadonlyMap<number, ReadonlyMap<Asset, unknown>> };
}): number {
  let total = 0;
  for (const perAsset of manifest.byWindow.values()) {
    total += perAsset.size;
  }
  return total;
}

function formatTableRange({
  table,
}: {
  readonly table: ProbabilityTable;
}): string {
  const first = new Date(table.trainingRangeMs.firstWindowMs)
    .toISOString()
    .slice(0, 10);
  const last = new Date(table.trainingRangeMs.lastWindowMs)
    .toISOString()
    .slice(0, 10);
  return `${first}..${last}`;
}

function summarizeWindow({
  windowStartMs,
  windowMetrics,
  sessionMetrics,
}: {
  readonly windowStartMs: number;
  readonly windowMetrics: DryAggregateMetrics;
  readonly sessionMetrics: DryAggregateMetrics;
}): string {
  const ts = new Date(windowStartMs).toISOString().slice(11, 16);
  return `replay window ${ts} | orders=${windowMetrics.orderCount} filled=${windowMetrics.canonical.filledCount} pnl=$${windowMetrics.canonical.pnlUsd.toFixed(2)} | session pnl=$${sessionMetrics.canonical.pnlUsd.toFixed(2)} (${sessionMetrics.orderCount} orders)`;
}

function serializeWindowOrders({
  result,
}: {
  readonly result: { readonly perAsset: ReadonlyMap<Asset, ReplayAssetResult> };
}): unknown[] {
  const out: unknown[] = [];
  for (const [, assetResult] of result.perAsset) {
    const envelope = assetResult.orderEnvelope;
    if (envelope === null) {
      continue;
    }
    out.push(serializeOrder({ envelope, outcome: assetResult.outcome }));
  }
  return out;
}

function serializeOrder({
  envelope,
  outcome,
}: {
  readonly envelope: ReplayOrderEnvelope;
  readonly outcome: ChainlinkOutcome | null;
}): Record<string, unknown> {
  const { order, decision } = envelope;
  return {
    id: order.id,
    asset: order.asset,
    windowStartMs: order.windowStartMs,
    windowEndMs: order.windowEndMs,
    vendorRef: order.vendorRef,
    outcomeRef: order.outcomeRef,
    side: order.side,
    limitPrice: order.limitPrice,
    sharesIfFilled: order.sharesIfFilled,
    placedAtMs: order.placedAtMs,
    expiresAtMs: order.expiresAtMs,
    queueAheadShares: order.queueAheadShares,
    observedAtLimitShares: order.observedAtLimitShares,
    canonicalFilledShares: order.canonicalFilledShares,
    canonicalCostUsd: order.canonicalCostUsd,
    canonicalFirstFillAtMs: order.canonicalFirstFillAtMs,
    canonicalFullFillAtMs: order.canonicalFullFillAtMs,
    touchFilledAtMs: order.touchFilledAtMs,
    entryPrice: envelope.entryPrice,
    line: envelope.line,
    polymarketReferencePrice: null,
    upBestBid: envelope.upBestBid,
    upBestAsk: envelope.upBestAsk,
    downBestBid: envelope.downBestBid,
    downBestAsk: envelope.downBestAsk,
    spread: envelope.spread,
    remaining: decision.snapshot.remaining,
    distanceBp: decision.snapshot.distanceBp,
    currentSide: decision.snapshot.currentSide,
    regime: decision.winningRegime.regime,
    decisivelyAway: null,
    ema50: decision.snapshot.ema50,
    samples: decision.winningRegime.samples,
    modelProbability: decision.chosen.ourProbability,
    edge: decision.chosen.edge,
    entryPriceTelemetry: envelope.entryPriceTelemetry,
    entryBookTelemetry: envelope.entryBookTelemetry,
    preEntryMarketTelemetry: envelope.preEntryMarketTelemetry,
    takerCounterfactual: envelope.takerCounterfactual,
    leadTimeCounterfactuals: buildLeadTimeForOrder({
      envelope,
      trades: [],
    }),
    // Chainlink is the "official" / settlement-of-record source per
    // user direction; polymarket-resolved is carried as the proxy /
    // sanity check. The dry-run report's
    // `officialProxyDisagreementCount` therefore counts windows where
    // the captured polymarket settlement diverged from the chainlink
    // reference value — the mismatch we want surfaced.
    officialOutcome: outcome === null ? null : outcome.winningSide,
    proxyOutcome: outcome?.polymarketResolution?.winningSide ?? null,
    officialResolvedAtMs:
      outcome?.polymarketResolution?.resolvedAtMs ?? null,
    officialPendingReason: null,
    replayOutcome: outcome,
  };
}

function serializeWindowChainlink({
  result,
}: {
  readonly result: { readonly perAsset: ReadonlyMap<Asset, ReplayAssetResult> };
}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [asset, assetResult] of result.perAsset) {
    out[asset] = {
      outcome: assetResult.outcome,
      outcomeError: assetResult.outcomeError,
      line: assetResult.line,
    };
  }
  return out;
}

/**
 * Default tick source for replay: derived from
 * `trainingCandleSeries` so the in-window BBO stream stays consistent
 * with whatever venue the active probability table was trained on.
 * Falls through to binance-perp if the training series doesn't map to
 * a captured BBO source we have wired up.
 */
function defaultTickSourceFromTrainingSeries(): ReplayTickSource {
  const { source, product } = trainingCandleSeries;
  if (source === "binance" && product === "perp") {
    return "binance-perp";
  }
  if (source === "coinbase" && product === "spot") {
    return "coinbase-spot";
  }
  if (source === "coinbase" && product === "perp") {
    return "coinbase-perp";
  }
  return "binance-perp";
}

/**
 * Returns the smallest index `i` such that `bars[i].openTimeMs >=
 * lessThanMs`. Equivalently, the count of bars whose `openTimeMs <
 * lessThanMs`. Assumes `bars` is sorted ascending by `openTimeMs` —
 * which `loadTrainingCandles` guarantees.
 */
function upperBoundOpenTime({
  bars,
  lessThanMs,
}: {
  readonly bars: readonly ClosedFiveMinuteBar[];
  readonly lessThanMs: number;
}): number {
  let lo = 0;
  let hi = bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const bar = bars[mid];
    if (bar !== undefined && bar.openTimeMs < lessThanMs) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

