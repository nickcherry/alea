import type { FilterBar } from "@alea/lib/filters/types";
import type { Asset } from "@alea/types/assets";

/**
 * Per-asset state held in memory by the dry-run runner. `bars` is
 * the rolling buffer of finalized 5m bars (hydrated from `candles`
 * at startup, then appended as ticks cross 5m boundaries).
 *
 * `currentBar` is the in-flight bar accumulator — running OHL from
 * every tick within the current 5m boundary, with `close` updated
 * on each tick. It rolls over to a new bar when a tick crosses the
 * 5m boundary (`floor(tick / 5min) * 5min` no longer matches).
 *
 * `lastPredictedBoundary` and `lastFinalizedBoundary` are
 * idempotency guards so the scheduler doesn't double-fire when the
 * loop runs more than once between events.
 */
export type DryRunAssetState = {
  readonly asset: Asset;
  bars: FilterBar[];
  currentBar: {
    openTimeMs: number;
    open: number;
    high: number;
    low: number;
    close: number;
  } | null;
  lastPredictedBoundary: number;
  lastFinalizedBoundary: number;
};
