import { FIVE_MINUTES_MS } from "@alea/lib/livePrices/fiveMinuteWindow";
import { computeRegimeClassifierInput } from "@alea/lib/livePrices/regimeContext";
import type { RegimeTrackers } from "@alea/lib/livePrices/regimeTrackers";
import type { LivePriceTick } from "@alea/lib/livePrices/types";
import {
  evaluateDecision,
  type TradeDecisionEvaluator,
} from "@alea/lib/trading/decision/evaluateDecision";
import type { TradeDecision } from "@alea/lib/trading/decision/types";
import {
  tickIsFresh,
  usableBookForMarket,
} from "@alea/lib/trading/live/freshness";
import type {
  AssetWindowRecord,
  BookCache,
  WindowRecord,
} from "@alea/lib/trading/live/types";
import type { LeadingSide, ProbabilityTable } from "@alea/lib/trading/types";
import type { Asset } from "@alea/types/assets";

export function evaluateRecordDecision({
  asset,
  record,
  window,
  lastTick,
  trackers,
  books,
  table,
  decisionEvaluator,
  minEdge,
  nowMs,
}: {
  readonly asset: Asset;
  readonly record: AssetWindowRecord;
  readonly window: Pick<WindowRecord, "windowStartMs">;
  readonly lastTick: ReadonlyMap<Asset, LivePriceTick>;
  readonly trackers: ReadonlyMap<Asset, RegimeTrackers>;
  readonly books: BookCache;
  readonly table?: ProbabilityTable;
  readonly decisionEvaluator?: TradeDecisionEvaluator;
  readonly minEdge: number;
  readonly nowMs: number;
}): TradeDecision | null {
  if (table === undefined && decisionEvaluator === undefined) {
    throw new Error(
      "evaluateRecordDecision requires table or decisionEvaluator",
    );
  }
  const market = record.market;
  if (
    market === null ||
    record.hydrationStatus !== "ready" ||
    record.line === null
  ) {
    return null;
  }
  const tick = lastTick.get(asset);
  const bundle = trackers.get(asset);
  if (tick === undefined || bundle === undefined) {
    return null;
  }
  if (!tickIsFresh({ tick, windowStartMs: window.windowStartMs, nowMs })) {
    return null;
  }
  // Buffer freshness: the last accepted closed bar must be the one
  // ending exactly at the current 5m window's start, matching the
  // training pipeline's "evaluated through and including the prior
  // closed bar" convention. If the buffer is stale (missed a kline
  // close), the REST-hydration helper will catch it on the next tick.
  if (bundle.lastBarOpenMs() !== window.windowStartMs - FIVE_MINUTES_MS) {
    return null;
  }
  const leadingSide: LeadingSide = tick.mid >= record.line ? "up" : "down";
  const regimeInput = computeRegimeClassifierInput({
    recentBars: bundle.bars(),
    windowStartMs: window.windowStartMs,
    leadingSide,
  });
  const book = usableBookForMarket({
    book: books.get(market.vendorRef),
    vendorRef: market.vendorRef,
    windowStartMs: market.windowStartMs,
    nowMs,
  });
  const baseInputs = {
    asset,
    windowStartMs: window.windowStartMs,
    nowMs,
    line: record.line,
    currentPrice: tick.mid,
    regimeInput,
    upBestBid: book?.up.bestBid ?? null,
    downBestBid: book?.down.bestBid ?? null,
    upBestAsk: book?.up.bestAsk ?? null,
    downBestAsk: book?.down.bestAsk ?? null,
    upTokenId: market.upRef,
    downTokenId: market.downRef,
    minEdge,
  };
  if (decisionEvaluator !== undefined) {
    return decisionEvaluator(baseInputs);
  }
  return evaluateDecision({
    ...baseInputs,
    table: table as ProbabilityTable,
  });
}
