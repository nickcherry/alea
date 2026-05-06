import type { ClosedFiveMinuteBar } from "@alea/lib/livePrices/types";

/**
 * Maximum number of recent closed 5m bars retained per asset for the
 * live regime classifier. Sized to the slowest seed any current
 * lookup needs (Wilder ATR-50 wants 50 bars) plus margin so a single
 * missed bar over the wire doesn't stall classification.
 *
 * Lookback is recomputed from this buffer on every decision tick, so
 * the cost scales with this number — kept tight enough that the
 * recompute is trivial.
 */
const MAX_BUFFERED_BARS = 70;

/**
 * Per-asset rolling buffer of recently-closed 5m bars. Replaces the
 * old per-feature tracker bundle (EMA-20, EMA-50, ATR-14, ATR-50,
 * etc.) with a single source of truth: the bars themselves. The live
 * decision evaluator runs the same `build5mLookback` (from
 * `computeSurvivalSnapshots`) over this buffer that the training-side
 * snapshot pipeline runs over historical candles, so every input the
 * lookback can compute is automatically available at decision time —
 * no per-feature wiring, no `LIVE_AVAILABLE_INPUTS`, no per-algo
 * feasibility check.
 *
 * Adding a regime algo that consumes a new feature (RSI, ATR-3,
 * prev-bar direction, anything else the lookback exposes): zero
 * plumbing. The buffer already provides it.
 */
export type RegimeTrackers = {
  /**
   * Append a closed bar. Returns `true` if accepted, `false` if
   * dropped (duplicate or out-of-order). Buffer is pruned to the
   * most recent `MAX_BUFFERED_BARS` after each accepted append.
   */
  readonly append: (bar: ClosedFiveMinuteBar) => boolean;
  /**
   * Snapshot of the buffer in chronological order (oldest first).
   * Returns the underlying array — callers should treat it as
   * read-only. The decision evaluator passes this to
   * `computeRegimeClassifierInput`.
   */
  readonly bars: () => readonly ClosedFiveMinuteBar[];
  /**
   * `openTimeMs` of the most recent bar accepted, or `null` when no
   * bars have been seen yet. Used by the live freshness check
   * ("does the buffer's last bar end exactly at the current 5m
   * window's start?").
   */
  readonly lastBarOpenMs: () => number | null;
  /** Total bars in the buffer. Useful for log lines. */
  readonly barCount: () => number;
};

export function createRegimeTrackers(): RegimeTrackers {
  const buffer: ClosedFiveMinuteBar[] = [];
  let lastOpenMs: number | null = null;
  return {
    append: (bar) => {
      if (lastOpenMs !== null && bar.openTimeMs <= lastOpenMs) {
        return false;
      }
      lastOpenMs = bar.openTimeMs;
      buffer.push(bar);
      while (buffer.length > MAX_BUFFERED_BARS) {
        buffer.shift();
      }
      return true;
    },
    bars: () => buffer,
    lastBarOpenMs: () => lastOpenMs,
    barCount: () => buffer.length,
  };
}

/**
 * Compact diagnostic string for log lines after a bar close or REST
 * hydration: how many bars are buffered and the timestamp of the most
 * recent one. Replaces the old per-tracker dump (`ema20=… atr14=…`)
 * with a single line that doesn't depend on which specific features
 * the regime algos read.
 */
export function describeRegimeTrackers({
  trackers,
}: {
  readonly trackers: RegimeTrackers;
}): string {
  const last = trackers.lastBarOpenMs();
  if (last === null) {
    return "buffer warming (0 bars)";
  }
  const lastIso = new Date(last).toISOString().slice(11, 16);
  return `buffer=${trackers.barCount()} bars, last=${lastIso} UTC`;
}
