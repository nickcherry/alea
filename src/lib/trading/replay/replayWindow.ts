import {
  MIN_QUEUE_AHEAD_SHARES,
  ORDER_CANCEL_MARGIN_MS,
  STAKE_USD,
} from "@alea/constants/trading";
import {
  FIVE_MINUTES_MS,
  flooredRemainingMinutes,
} from "@alea/lib/livePrices/fiveMinuteWindow";
import { computeRegimeClassifierInput } from "@alea/lib/livePrices/regimeContext";
import type { RegimeTrackers } from "@alea/lib/livePrices/regimeTrackers";
import type { LivePriceTick } from "@alea/lib/livePrices/types";
import { evaluateDecision } from "@alea/lib/trading/decision/evaluateDecision";
import type { TradeDecision } from "@alea/lib/trading/decision/types";
import {
  applyTradeToSimulatedOrder,
  createSimulatedDryOrder,
  type SimulatedDryOrder,
} from "@alea/lib/trading/dryRun/fillSimulation";
import {
  appendMarketTrade,
  appendPriceTick,
  buildEntryBookTelemetry,
  buildEntryPriceTelemetry,
  buildLeadTimeCounterfactuals,
  buildPreEntryMarketTelemetry,
  buildTakerCounterfactual,
  type DryEntryBookTelemetry,
  type DryEntryPriceTelemetry,
  type DryMarketTradeHistory,
  type DryPreEntryMarketTelemetry,
  type DryPriceHistory,
  type DryTakerCounterfactual,
} from "@alea/lib/trading/dryRun/telemetry";
import {
  MAX_BOOK_AGE_MS,
  MAX_LINE_CAPTURE_LAG_MS,
} from "@alea/lib/trading/live/freshness";
import { decimalsFor, labelAsset } from "@alea/lib/trading/live/utils";
import type { ReplayMarket } from "@alea/lib/trading/replay/derivedMarkets";
import type {
  ChainlinkOutcome,
  ChainlinkResolutionError,
} from "@alea/lib/trading/replay/resolveWindowOutcome";
import { resolveWindowOutcome } from "@alea/lib/trading/replay/resolveWindowOutcome";
import type {
  ReplayChainlinkRefPriceEvent,
  ReplayEvent,
  ReplayRunEvent,
  ReplayTickSource,
} from "@alea/lib/trading/replay/types";
import type { LeadingSide, ProbabilityTable } from "@alea/lib/trading/types";
import type {
  MarketDataTradeEvent,
  PreparedMakerLimitOrder,
  PriceLevel,
  TradableMarket,
  UpDownBook,
} from "@alea/lib/trading/vendor/types";
import type { Asset } from "@alea/types/assets";

/**
 * Replay-time analogue of the live `prepareMakerLimitBuy`. Inlined
 * here rather than imported from the polymarket vendor module because
 * the vendor's version (a) reads `Date.now()` directly (no hook for
 * a virtual clock) and (b) requires runtime venue constraints we
 * don't have in the captured tape. We hard-code the known-stable
 * Polymarket up/down 5m parameters: 0.01 tick size, 60s min validity,
 * 5-share min order. Any market that diverges from those would
 * diverge from this replay, which we accept for v1.
 */
const POLYMARKET_TICK_SIZE = 0.01;
const POLYMARKET_MIN_ORDER_SIZE = 5;
const GTD_MIN_VALIDITY_MS = 61_000;
const PLACE_GIVE_UP_BEFORE_END_MS =
  ORDER_CANCEL_MARGIN_MS + GTD_MIN_VALIDITY_MS;
const SHARE_QUANTUM = 100;

export type ReplayWindowParams = {
  readonly windowStartMs: number;
  readonly markets: ReadonlyMap<Asset, ReplayMarket>;
  readonly events: readonly ReplayEvent[];
  readonly chainlinkByAsset: ReadonlyMap<
    Asset,
    readonly ReplayChainlinkRefPriceEvent[]
  >;
  /**
   * Per-asset rolling 5m bar buffer hydrated by the orchestrator
   * before this window starts (typically from the candles table).
   * The driver only reads from these — it does not append.
   */
  readonly trackers: ReadonlyMap<Asset, RegimeTrackers>;
  readonly table: ProbabilityTable;
  readonly minEdge: number;
  readonly stakeUsd?: number;
  /**
   * Which captured BBO stream the per-window driver consumes as its
   * `lastTick` / line-capture source. Defaults to `binance-perp` to
   * match the live trader; override when replaying head-to-head
   * against a model trained on a different venue.
   */
  readonly tickSource?: ReplayTickSource;
  /**
   * Cancel a placed order if the underlying tick mid moves against
   * our predicted side by at least N basis points after placement
   * (vs the captured `state.line`). Default 0 = no cancellation
   * (current behaviour). Use 5–20 to test adverse-selection escape.
   * Cancel rule:
   *   - side=up and mid drops ≥ N bp from line → cancel
   *   - side=down and mid rises ≥ N bp from line → cancel
   * Cancellation prevents subsequent trades from filling our order
   * via `applyTradeToSimulatedOrder`.
   */
  readonly cancelOnAdverseBp?: number;
  readonly emit: (event: ReplayRunEvent) => void;
};

export type ReplayAssetResult = {
  readonly asset: Asset;
  readonly market: TradableMarket;
  readonly line: number | null;
  readonly lineCapturedAtMs: number | null;
  readonly orderEnvelope: ReplayOrderEnvelope | null;
  readonly outcome: ChainlinkOutcome | null;
  readonly outcomeError: ChainlinkResolutionError | null;
  readonly skipReason: string | null;
};

export type ReplayOrderEnvelope = {
  readonly order: SimulatedDryOrder;
  readonly prepared: PreparedMakerLimitOrder;
  readonly decision: Extract<TradeDecision, { kind: "trade" }>;
  readonly entryPrice: number;
  readonly line: number;
  readonly upBestBid: number | null;
  readonly upBestAsk: number | null;
  readonly downBestBid: number | null;
  readonly downBestAsk: number | null;
  readonly spread: number | null;
  readonly entryPriceTelemetry: DryEntryPriceTelemetry | null;
  readonly entryBookTelemetry: DryEntryBookTelemetry;
  readonly preEntryMarketTelemetry: DryPreEntryMarketTelemetry;
  readonly takerCounterfactual: DryTakerCounterfactual | null;
};

export type ReplayWindowResult = {
  readonly windowStartMs: number;
  readonly windowEndMs: number;
  readonly perAsset: ReadonlyMap<Asset, ReplayAssetResult>;
};

/**
 * Walks every captured event for one 5-minute window in event-time
 * order and reproduces the live trader's per-asset decision +
 * placement + fill-simulation behaviour. Pure (no IO) once the
 * pre-bucketed inputs are in hand — the orchestrator handles loading
 * events, hydrating trackers from candles, and writing JSONL.
 *
 * Decision-firing semantics mirror the live runner:
 *   - At each in-window minute boundary (`+1m`, `+2m`, `+3m`, `+4m`)
 *     fire a decision per-asset if the bucket flipped or the slot is
 *     still empty.
 *   - On every polymarket book/best-bid-ask update for an asset whose
 *     slot is still empty, also fire a decision.
 *
 * Order placement reproduces dry-run's behaviour bit-for-bit:
 *   - Mirror the `MIN_QUEUE_AHEAD_SHARES` queue-depth gate.
 *   - Mirror the `PLACE_GIVE_UP_BEFORE_END_MS` cutoff.
 *   - Hand the prepared order to `applyTradeToSimulatedOrder` for
 *     every subsequent in-window trade event on the chosen outcome.
 *
 * Outcome resolution uses chainlink as truth and surfaces any
 * disagreement with the captured polymarket `resolved` event in the
 * per-asset result.
 */
export function replayWindow({
  windowStartMs,
  markets,
  events,
  chainlinkByAsset,
  trackers,
  table,
  minEdge,
  stakeUsd = STAKE_USD,
  tickSource = "binance-perp",
  cancelOnAdverseBp = 0,
  emit,
}: ReplayWindowParams): ReplayWindowResult {
  const windowEndMs = windowStartMs + FIVE_MINUTES_MS;
  const states = new Map<Asset, AssetState>();
  for (const [asset, replayMarket] of markets) {
    states.set(asset, createAssetState({ asset, market: replayMarket.market }));
  }

  // Token id → asset for fast routing of polymarket events.
  const tokenToAsset = new Map<string, Asset>();
  for (const [asset, replayMarket] of markets) {
    tokenToAsset.set(replayMarket.market.upRef, asset);
    tokenToAsset.set(replayMarket.market.downRef, asset);
  }

  const boundaries = [
    windowStartMs + 60_000,
    windowStartMs + 120_000,
    windowStartMs + 180_000,
    windowStartMs + 240_000,
  ] as const;
  let nextBoundaryIdx = 0;

  const fireBoundaryAt = (nowMs: number): void => {
    for (const [asset, state] of states) {
      const remaining = flooredRemainingMinutes({ windowStartMs, nowMs });
      if (remaining === null) {
        continue;
      }
      const bucketChanged = remaining !== state.lastDecisionRemaining;
      const slotEmpty = state.order === null;
      if (!bucketChanged && !slotEmpty) {
        continue;
      }
      tryDecide({
        asset,
        state,
        nowMs,
        trackers,
        table,
        minEdge,
        stakeUsd,
        emit,
      });
      if (bucketChanged) {
        state.lastDecisionRemaining = remaining;
      }
    }
  };

  for (const event of events) {
    const nowMs = event.tsMs;

    while (
      nextBoundaryIdx < boundaries.length &&
      (boundaries[nextBoundaryIdx] ?? Number.POSITIVE_INFINITY) <= nowMs
    ) {
      const boundaryMs = boundaries[nextBoundaryIdx];
      if (boundaryMs !== undefined) {
        fireBoundaryAt(boundaryMs);
      }
      nextBoundaryIdx += 1;
    }

    if (event.source === tickSource && event.kind === "bbo") {
      handleTickBbo({ event, states, windowStartMs });
      if (cancelOnAdverseBp > 0) {
        const state = states.get(event.asset);
        if (state !== undefined) {
          maybeCancelOnAdverse({ state, nowMs: event.tsMs, thresholdBp: cancelOnAdverseBp });
        }
      }
      continue;
    }
    if (event.source === "polymarket") {
      handlePolymarketEvent({
        event,
        states,
        tokenToAsset,
        trackers,
        table,
        minEdge,
        stakeUsd,
        emit,
      });
      continue;
    }
    // chainlink + other events are consumed at outcome resolution
    // time, not during the in-window walk.
  }

  while (nextBoundaryIdx < boundaries.length) {
    const boundaryMs = boundaries[nextBoundaryIdx];
    if (boundaryMs !== undefined) {
      fireBoundaryAt(boundaryMs);
    }
    nextBoundaryIdx += 1;
  }

  // Build per-asset result with chainlink-derived outcome attached.
  const perAsset = new Map<Asset, ReplayAssetResult>();
  for (const [asset, state] of states) {
    const replayMarket = markets.get(asset);
    if (replayMarket === undefined) {
      continue;
    }
    const chainlink = chainlinkByAsset.get(asset) ?? [];
    const resolution = resolveWindowOutcome({
      windowStartMs,
      chainlinkEvents: chainlink,
      polymarketResolution: replayMarket.polymarketResolved,
    });

    perAsset.set(asset, {
      asset,
      market: replayMarket.market,
      line: state.line,
      lineCapturedAtMs: state.lineCapturedAtMs,
      orderEnvelope: state.order,
      outcome: resolution.status === "resolved" ? resolution.outcome : null,
      outcomeError: resolution.status === "error" ? resolution.error : null,
      skipReason: state.skipReason,
    });
  }

  return { windowStartMs, windowEndMs, perAsset };
}

type AssetState = {
  readonly asset: Asset;
  readonly market: TradableMarket;
  line: number | null;
  lineCapturedAtMs: number | null;
  lastTick: LivePriceTick | null;
  book: UpDownBook | null;
  priceHistory: DryPriceHistory;
  marketTradesByOutcome: DryMarketTradeHistory;
  lastDecisionRemaining: number | null;
  order: ReplayOrderEnvelope | null;
  /**
   * Wall-clock ms at which the order was cancelled by the
   * cancel-on-adverse rule. Trades after this point are not allowed
   * to fill the order. Null while order is still active.
   */
  orderCancelledAtMs: number | null;
  skipReason: string | null;
};

function createAssetState({
  asset,
  market,
}: {
  readonly asset: Asset;
  readonly market: TradableMarket;
}): AssetState {
  return {
    asset,
    market,
    line: null,
    lineCapturedAtMs: null,
    lastTick: null,
    book: null,
    priceHistory: new Map(),
    marketTradesByOutcome: new Map(),
    lastDecisionRemaining: null,
    order: null,
    orderCancelledAtMs: null,
    skipReason: null,
  };
}

function maybeCancelOnAdverse({
  state,
  nowMs,
  thresholdBp,
}: {
  readonly state: AssetState;
  readonly nowMs: number;
  readonly thresholdBp: number;
}): void {
  const order = state.order;
  if (order === null || state.orderCancelledAtMs !== null) return;
  const tick = state.lastTick;
  if (tick === null) return;
  const line = order.line;
  if (line <= 0) return;
  const movedBp = ((tick.mid - line) / line) * 10_000;
  // For an "up" side bet, adverse = price drops below line.
  // For a "down" side bet, adverse = price rises above line.
  const adverseBp =
    order.order.side === "up" ? -movedBp : movedBp;
  if (adverseBp >= thresholdBp) {
    state.orderCancelledAtMs = nowMs;
  }
}

function handleTickBbo({
  event,
  states,
  windowStartMs,
}: {
  readonly event: Extract<
    ReplayEvent,
    { source: "binance-perp" | "coinbase-spot" | "coinbase-perp"; kind: "bbo" }
  >;
  readonly states: Map<Asset, AssetState>;
  readonly windowStartMs: number;
}): void {
  const state = states.get(event.asset);
  if (state === undefined) {
    return;
  }
  const tick: LivePriceTick = {
    asset: event.asset,
    bid: event.bid,
    ask: event.ask,
    mid: event.mid,
    exchangeTimeMs: event.tsExchangeMs,
    receivedAtMs: event.receivedMs,
  };
  state.lastTick = tick;
  appendPriceTick({ history: state.priceHistory, tick });

  if (
    state.line === null &&
    event.tsMs >= windowStartMs &&
    event.tsMs <= windowStartMs + MAX_LINE_CAPTURE_LAG_MS
  ) {
    state.line = event.mid;
    state.lineCapturedAtMs = event.tsMs;
  }
}

function handlePolymarketEvent({
  event,
  states,
  tokenToAsset,
  trackers,
  table,
  minEdge,
  stakeUsd,
  emit,
}: {
  readonly event: Extract<ReplayEvent, { source: "polymarket" }>;
  readonly states: Map<Asset, AssetState>;
  readonly tokenToAsset: ReadonlyMap<string, Asset>;
  readonly trackers: ReadonlyMap<Asset, RegimeTrackers>;
  readonly table: ProbabilityTable;
  readonly minEdge: number;
  readonly stakeUsd: number;
  readonly emit: (event: ReplayRunEvent) => void;
}): void {
  if (event.kind === "resolved") {
    // Resolved events are folded into the manifest at load time;
    // no per-window state to update here.
    return;
  }
  if (event.kind === "book" || event.kind === "best-bid-ask") {
    const asset = tokenToAsset.get(event.event.outcomeRef);
    if (asset === undefined) {
      return;
    }
    const state = states.get(asset);
    if (state === undefined) {
      return;
    }
    applyBookEvent({ state, event });
    if (state.order === null) {
      tryDecide({
        asset,
        state,
        nowMs: event.tsMs,
        trackers,
        table,
        minEdge,
        stakeUsd,
        emit,
      });
    }
    return;
  }
  // trade
  const asset = tokenToAsset.get(event.event.outcomeRef);
  if (asset === undefined) {
    return;
  }
  const state = states.get(asset);
  if (state === undefined) {
    return;
  }
  appendMarketTrade({
    history: state.marketTradesByOutcome,
    trade: event.event,
    nowMs: event.tsMs,
  });
  if (state.order !== null) {
    // Cancel-on-adverse: if the order was already cancelled by an
    // adverse tick before this trade arrived, the order is "cancelled
    // first, trade second" — skip the fill.
    if (
      state.orderCancelledAtMs !== null &&
      event.event.atMs >= state.orderCancelledAtMs
    ) {
      return;
    }
    const before = state.order.order.canonicalFilledShares;
    const changed = applyTradeToSimulatedOrder({
      order: state.order.order,
      trade: event.event,
    });
    if (changed && state.order.order.canonicalFilledShares > before) {
      emit({
        kind: "virtual-fill",
        atMs: event.event.atMs,
        asset,
        order: state.order.order,
      });
    }
  }
}

function applyBookEvent({
  state,
  event,
}: {
  readonly state: AssetState;
  readonly event: Extract<
    ReplayEvent,
    { source: "polymarket"; kind: "book" | "best-bid-ask" }
  >;
}): void {
  const market = state.market;
  const side: "up" | "down" =
    event.event.outcomeRef === market.upRef ? "up" : "down";
  const existing = state.book ?? {
    market,
    up: { bestBid: null, bestAsk: null },
    down: { bestBid: null, bestAsk: null },
    fetchedAtMs: event.event.atMs,
  };
  const top =
    event.kind === "book"
      ? {
          bestBid: bestFromLevels({ levels: event.event.bids, side: "bid" }),
          bestAsk: bestFromLevels({ levels: event.event.asks, side: "ask" }),
          bidLevels: event.event.bids,
          askLevels: event.event.asks,
        }
      : {
          ...existing[side],
          bestBid: event.event.bestBid,
          bestAsk: event.event.bestAsk,
        };
  state.book = {
    ...existing,
    [side]: top,
    fetchedAtMs: event.event.atMs,
  };
}

function tryDecide({
  asset,
  state,
  nowMs,
  trackers,
  table,
  minEdge,
  stakeUsd,
  emit,
}: {
  readonly asset: Asset;
  readonly state: AssetState;
  readonly nowMs: number;
  readonly trackers: ReadonlyMap<Asset, RegimeTrackers>;
  readonly table: ProbabilityTable;
  readonly minEdge: number;
  readonly stakeUsd: number;
  readonly emit: (event: ReplayRunEvent) => void;
}): void {
  const market = state.market;
  if (state.line === null) {
    return;
  }
  const tick = state.lastTick;
  const bundle = trackers.get(asset);
  if (tick === null || bundle === undefined) {
    return;
  }
  // tick freshness mirror: must be from this window or later.
  const tickReferenceMs = tick.exchangeTimeMs ?? tick.receivedAtMs;
  if (tickReferenceMs < market.windowStartMs) {
    return;
  }
  // Buffer freshness mirror: the prior closed bar must end exactly
  // at this window's start. If the orchestrator's hydration left the
  // buffer one bar short, evaluating would silently fall through
  // warmup; better to skip cleanly.
  if (
    bundle.lastBarOpenMs() !== market.windowStartMs - FIVE_MINUTES_MS
  ) {
    return;
  }
  const leadingSide: LeadingSide =
    tick.mid >= state.line ? "up" : "down";
  const regimeInput = computeRegimeClassifierInput({
    recentBars: bundle.bars(),
    windowStartMs: market.windowStartMs,
    leadingSide,
  });
  const book = state.book;
  const useBook =
    book !== null &&
    book.market.vendorRef === market.vendorRef &&
    book.fetchedAtMs >= market.windowStartMs &&
    nowMs - book.fetchedAtMs <= MAX_BOOK_AGE_MS;

  const decision = evaluateDecision({
    asset,
    windowStartMs: market.windowStartMs,
    nowMs,
    line: state.line,
    currentPrice: tick.mid,
    regimeInput,
    upBestBid: useBook ? book.up.bestBid : null,
    downBestBid: useBook ? book.down.bestBid : null,
    upTokenId: market.upRef,
    downTokenId: market.downRef,
    table,
    minEdge,
  });

  emit({ kind: "decision", atMs: nowMs, decision });

  if (
    decision.kind !== "trade" ||
    state.order !== null ||
    !market.acceptingOrders
  ) {
    return;
  }
  if (nowMs >= market.windowEndMs - PLACE_GIVE_UP_BEFORE_END_MS) {
    state.skipReason = "too-late-in-window";
    return;
  }
  if (decision.chosen.bid === null) {
    return;
  }
  if (book === null) {
    return;
  }

  // Mirror prepareMakerLimitBuy: tick price down, compute share
  // count at SHARE_QUANTUM granularity, enforce min order size and
  // GTD validity buffer.
  const tickedPrice =
    Math.floor(decision.chosen.bid / POLYMARKET_TICK_SIZE) *
    POLYMARKET_TICK_SIZE;
  if (tickedPrice <= 0 || tickedPrice >= 1) {
    state.skipReason = "ticked-price-out-of-range";
    return;
  }
  if (nowMs + GTD_MIN_VALIDITY_MS >= market.windowEndMs - ORDER_CANCEL_MARGIN_MS) {
    state.skipReason = "below-gtd-validity";
    return;
  }
  const rawShares = stakeUsd / tickedPrice;
  const sharesIfFilled = Math.floor(rawShares * SHARE_QUANTUM) / SHARE_QUANTUM;
  if (sharesIfFilled <= 0 || sharesIfFilled < POLYMARKET_MIN_ORDER_SIZE) {
    state.skipReason = `shares-below-min (${sharesIfFilled})`;
    return;
  }
  const expiresAtMs = market.windowEndMs - ORDER_CANCEL_MARGIN_MS;
  const queueAheadShares = queueAheadAtLimit({
    book,
    side: decision.chosen.side,
    limitPrice: tickedPrice,
  });
  if (
    queueAheadShares !== null &&
    queueAheadShares < MIN_QUEUE_AHEAD_SHARES
  ) {
    state.skipReason = `shallow-queue (${queueAheadShares.toFixed(2)} < ${MIN_QUEUE_AHEAD_SHARES})`;
    return;
  }

  const prepared: PreparedMakerLimitOrder = {
    side: decision.chosen.side,
    outcomeRef: decision.chosen.tokenId,
    limitPrice: tickedPrice,
    sharesIfFilled,
    feeRateBps: 0,
    orderType: "GTD",
    expiresAtMs,
    preparedAtMs: nowMs,
  };
  const orderId = `replay-${market.vendorRef}-${prepared.outcomeRef}-${nowMs}`;
  const order = createSimulatedDryOrder({
    id: orderId,
    asset,
    windowStartMs: market.windowStartMs,
    windowEndMs: market.windowEndMs,
    vendorRef: market.vendorRef,
    outcomeRef: prepared.outcomeRef,
    side: prepared.side,
    limitPrice: prepared.limitPrice,
    sharesIfFilled: prepared.sharesIfFilled,
    placedAtMs: nowMs,
    expiresAtMs,
    queueAheadShares,
  });

  const top = topForSide({ book, side: prepared.side });
  const outcomeTrades =
    state.marketTradesByOutcome.get(prepared.outcomeRef) ?? [];
  state.order = {
    order,
    prepared,
    decision,
    entryPrice: tick.mid,
    line: state.line,
    upBestBid: book.up.bestBid,
    upBestAsk: book.up.bestAsk,
    downBestBid: book.down.bestBid,
    downBestAsk: book.down.bestAsk,
    spread:
      top.bestBid === null || top.bestAsk === null
        ? null
        : top.bestAsk - top.bestBid,
    entryPriceTelemetry: buildEntryPriceTelemetry({
      ticks: state.priceHistory.get(asset) ?? [],
      placedAtMs: nowMs,
      line: state.line,
    }),
    entryBookTelemetry: buildEntryBookTelemetry({
      book,
      side: prepared.side,
      limitPrice: prepared.limitPrice,
      queueAheadShares,
      placedAtMs: nowMs,
    }),
    preEntryMarketTelemetry: buildPreEntryMarketTelemetry({
      trades: outcomeTrades,
      placedAtMs: nowMs,
      limitPrice: prepared.limitPrice,
    }),
    takerCounterfactual: buildTakerCounterfactual({
      book,
      side: prepared.side,
      stakeUsd,
    }),
  };
  emit({
    kind: "virtual-order",
    atMs: nowMs,
    asset,
    order,
    stakeUsd,
    entryPrice: tick.mid,
    line: state.line,
    modelProbability: decision.chosen.ourProbability,
    edge: decision.chosen.edge,
    body: `${labelAsset(asset)} replay virtual-order ${decision.chosen.side}@${prepared.limitPrice.toFixed(decimalsFor({ asset }))} stake=$${stakeUsd}`,
  });
}

export function buildLeadTimeForOrder({
  envelope,
  trades,
}: {
  readonly envelope: ReplayOrderEnvelope;
  readonly trades: readonly MarketDataTradeEvent[];
}) {
  return buildLeadTimeCounterfactuals({
    trades,
    order: {
      placedAtMs: envelope.order.placedAtMs,
      expiresAtMs: envelope.order.expiresAtMs,
      limitPrice: envelope.order.limitPrice,
    },
  });
}

function bestFromLevels({
  levels,
  side,
}: {
  readonly levels: readonly PriceLevel[];
  readonly side: "bid" | "ask";
}): number | null {
  let best: number | null = null;
  for (const level of levels) {
    if (best === null) {
      best = level.price;
      continue;
    }
    if (side === "bid" ? level.price > best : level.price < best) {
      best = level.price;
    }
  }
  return best;
}

function topForSide({
  book,
  side,
}: {
  readonly book: UpDownBook;
  readonly side: LeadingSide;
}): { readonly bestBid: number | null; readonly bestAsk: number | null } {
  return side === "up" ? book.up : book.down;
}

function queueAheadAtLimit({
  book,
  side,
  limitPrice,
}: {
  readonly book: UpDownBook;
  readonly side: LeadingSide;
  readonly limitPrice: number;
}): number | null {
  const levels = side === "up" ? book.up.bidLevels : book.down.bidLevels;
  if (levels === undefined) {
    return null;
  }
  const level = levels.find(
    (entry) => Math.abs(entry.price - limitPrice) < 1e-9,
  );
  return level?.size ?? 0;
}
