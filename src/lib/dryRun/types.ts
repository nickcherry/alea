import type { TradeDecisionPeriod } from "@alea/constants/tradeDecision";
import type { FilterBar } from "@alea/lib/filters/types";
import type { Asset } from "@alea/types/assets";

/**
 * Per-asset/per-period state held in memory by the dry-run runner.
 * `bars` is the rolling buffer of finalized bars hydrated from
 * `candles` at startup, then appended as ticks cross that period's
 * boundary.
 *
 * `currentBar` is the in-flight bar accumulator — running OHL from
 * every tick within the current boundary, with `close` updated on
 * each tick. It rolls over to a new bar when a tick crosses the
 * configured period boundary.
 *
 * `lastPredictedBoundary` is an idempotency guard so the scheduler
 * doesn't double-fire when the loop runs more than once between
 * events.
 */
export type DryRunAssetState = {
  readonly asset: Asset;
  readonly period: TradeDecisionPeriod;
  readonly periodMs: number;
  bars: FilterBar[];
  currentBar: {
    openTimeMs: number;
    open: number;
    high: number;
    low: number;
    close: number;
  } | null;
  lastPredictedBoundary: number;
};
