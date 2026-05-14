import type { ResolutionTimeframe } from "@alea/types/resolutions";

/**
 * "Minutes before candle close" we evaluate for the intra-candle drift
 * research. For each `L`, we take the 1m bar whose close lands `L`
 * minutes before the period candle's close, then compare that price to
 * the period candle's close.
 *
 * Output is plotted as a percentile band and a threshold-share band on
 * the price-paths dashboard. The operator uses it to gauge when in a
 * candle's life the price has effectively settled.
 */
export const LEAD_MINUTES_BY_PERIOD: Record<
  ResolutionTimeframe,
  readonly number[]
> = {
  "5m": [1, 2, 3, 4],
  "15m": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
};

/**
 * Drift bands plotted on the second chart. Each entry is an absolute
 * `|drift_bps| ≤ N` threshold; the chart shows, per lead minute, the
 * share of candles whose price at that lead was within the band of the
 * eventual close.
 */
export const LEAD_TIME_DRIFT_THRESHOLD_BPS: readonly number[] = [2, 5, 10];
