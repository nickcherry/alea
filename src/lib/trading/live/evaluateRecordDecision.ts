import { STAKE_USD } from "@alea/constants/trading";
import { FIVE_MINUTES_MS } from "@alea/lib/livePrices/fiveMinuteWindow";
import { computeRegimeClassifierInput } from "@alea/lib/livePrices/regimeContext";
import type { RegimeTrackers } from "@alea/lib/livePrices/regimeTrackers";
import type { LivePriceTick } from "@alea/lib/livePrices/types";
import {
  evaluateDecision,
  type TradeDecisionEvaluator,
} from "@alea/lib/trading/decision/evaluateDecision";
import type { TradeDecision } from "@alea/lib/trading/decision/types";
import { buildTakerCounterfactual } from "@alea/lib/trading/dryRun/telemetry";
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
import type { UpDownBook } from "@alea/lib/trading/vendor/types";
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
  placementMode,
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
  /**
   * Tells the EV / RR gate which fill-price model to feed into the
   * decision. Maker mode → fillPrice = bid, fee = 0. Taker mode →
   * fillPrice = `buildTakerCounterfactual().avgPrice` per side, fee
   * = the same helper's `estimatedFeeUsd`. Optional for backwards
   * compat with callers that don't care about the EV gate (in which
   * case the evaluator falls back to bid-as-fillPrice with zero
   * fee, i.e. the maker assumption).
   */
  readonly placementMode?: "maker" | "taker";
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
  const fillEconomics = computeFillEconomics({
    book,
    placementMode,
    stakeUsd: STAKE_USD,
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
    upFillPrice: fillEconomics.upFillPrice,
    downFillPrice: fillEconomics.downFillPrice,
    upFeeUsd: fillEconomics.upFeeUsd,
    downFeeUsd: fillEconomics.downFeeUsd,
    stakeUsd: STAKE_USD,
  };
  if (decisionEvaluator !== undefined) {
    return decisionEvaluator(baseInputs);
  }
  return evaluateDecision({
    ...baseInputs,
    table: table as ProbabilityTable,
  });
}

/**
 * Per-side fill price + fee for the EV / RR gate. For maker mode the
 * fillPrice is just the resting bid (we sit at the bid; fee = 0).
 * For taker mode we walk the asks via `buildTakerCounterfactual` to
 * get the depth-weighted average price plus the venue's estimated
 * fee at the matched depth.
 *
 * Returning all-null when no book is available (the legacy path
 * before the trader has seen a fresh book) makes the evaluator skip
 * the EV gate cleanly — better than gating on stale data. The model
 * gates above the EV check still fire on this same code path.
 */
function computeFillEconomics({
  book,
  placementMode,
  stakeUsd,
}: {
  readonly book: UpDownBook | null;
  readonly placementMode: "maker" | "taker" | undefined;
  readonly stakeUsd: number;
}): {
  upFillPrice: number | null;
  downFillPrice: number | null;
  upFeeUsd: number;
  downFeeUsd: number;
} {
  if (book === null) {
    return {
      upFillPrice: null,
      downFillPrice: null,
      upFeeUsd: 0,
      downFeeUsd: 0,
    };
  }
  if (placementMode !== "taker") {
    return {
      upFillPrice: book.up.bestBid,
      downFillPrice: book.down.bestBid,
      upFeeUsd: 0,
      downFeeUsd: 0,
    };
  }
  const upTaker = buildTakerCounterfactual({ book, side: "up", stakeUsd });
  const downTaker = buildTakerCounterfactual({ book, side: "down", stakeUsd });
  return {
    upFillPrice: upTaker?.avgPrice ?? null,
    downFillPrice: downTaker?.avgPrice ?? null,
    upFeeUsd: upTaker?.estimatedFeeUsd ?? 0,
    downFeeUsd: downTaker?.estimatedFeeUsd ?? 0,
  };
}
