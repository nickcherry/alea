import type { FilterBar } from "@alea/lib/filters/types";
import type { MarketRegime } from "@alea/lib/regime/types";

/**
 * Bars used as the volatility baseline. We compare recent realised
 * vol against this longer-window median; "recent vol is markedly
 * above baseline" = high-vol regime, otherwise low-vol. 100 bars at
 * 5m ≈ 8h, long enough to cover a typical session-of-day shape.
 */
const BASELINE_BARS = 100;

/**
 * Bars used to compute "recent" realised vol and trend strength.
 */
const RECENT_BARS = 20;

/**
 * Trend strength threshold. Computed as `|linreg_slope| * RECENT_BARS / ATR(RECENT_BARS)`
 * — i.e. how many ATRs the regression line travels over the window.
 * A value of 1.2 means the trend covers ~1.2 ATRs over 20 bars,
 * which empirically separates "going somewhere" from "drifting".
 */
const TREND_THRESHOLD = 1.2;

/**
 * High-vol ratio threshold. Recent realised vol / baseline median.
 * 1.3 keeps a fairly wide "normal" band so we don't whip between
 * regimes — only meaningfully elevated vol counts as high.
 */
const HIGH_VOL_RATIO = 1.3;

/**
 * Classify the current market regime from a bar window. Returns
 * `null` when the bar buffer is too short to compute a stable read
 * (we need at least BASELINE_BARS).
 *
 * The window order is ascending by openTimeMs; the most recent bar
 * is `bars[bars.length - 1]`.
 */
export function classifyMarketRegime({
  bars,
}: {
  readonly bars: readonly FilterBar[];
}): MarketRegime | null {
  if (bars.length < BASELINE_BARS) return null;

  // Volatility component: realised vol on the recent slice vs
  // distribution of realised vols across baseline windows.
  const recent = bars.slice(-RECENT_BARS);
  const recentVol = realisedVol(recent);
  const baselineMedian = baselineVolMedian(bars);
  const isHighVol = baselineMedian > 0 && recentVol / baselineMedian > HIGH_VOL_RATIO;

  // Directionality component: |linreg slope * n| relative to ATR.
  const slope = linregSlope(recent);
  const atr = avgTrueRange(recent);
  const trendStrength = atr === 0 ? 0 : (Math.abs(slope) * RECENT_BARS) / atr;
  const isTrending = trendStrength > TREND_THRESHOLD;

  if (isHighVol && isTrending) return "high_vol_trending";
  if (isHighVol && !isTrending) return "high_vol_ranging";
  if (!isHighVol && isTrending) return "low_vol_trending";
  return "low_vol_ranging";
}

/**
 * Standard deviation of log returns across the window. Returns 0
 * for windows shorter than 2.
 */
function realisedVol(bars: readonly FilterBar[]): number {
  if (bars.length < 2) return 0;
  const returns: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1]!.close;
    const curr = bars[i]!.close;
    if (prev <= 0 || curr <= 0) continue;
    returns.push(Math.log(curr / prev));
  }
  if (returns.length === 0) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance);
}

/**
 * Median realised vol across rolling RECENT_BARS-sized windows in
 * the bar history. Stable enough as a "what's normal" baseline.
 */
function baselineVolMedian(bars: readonly FilterBar[]): number {
  const vols: number[] = [];
  for (let i = RECENT_BARS; i <= bars.length; i++) {
    const window = bars.slice(i - RECENT_BARS, i);
    vols.push(realisedVol(window));
  }
  if (vols.length === 0) return 0;
  vols.sort((a, b) => a - b);
  return vols[Math.floor(vols.length / 2)]!;
}

/**
 * Linear regression slope of close vs index. Index is 0..n-1 to
 * sidestep big-number numerics on timestamps. Slope is in
 * (price units per bar).
 */
function linregSlope(bars: readonly FilterBar[]): number {
  const n = bars.length;
  if (n < 2) return 0;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i++) {
    const y = bars[i]!.close;
    sumX += i;
    sumY += y;
    sumXY += i * y;
    sumXX += i * i;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

/**
 * Simple Wilder-style average true range across the window. Uses
 * mean of true ranges, not the smoothed variant — adequate for a
 * regime baseline (we only need a stable per-bar volatility unit).
 */
function avgTrueRange(bars: readonly FilterBar[]): number {
  if (bars.length < 2) return 0;
  let sum = 0;
  let count = 0;
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1]!;
    const curr = bars[i]!;
    const tr = Math.max(
      curr.high - curr.low,
      Math.abs(curr.high - prev.close),
      Math.abs(curr.low - prev.close),
    );
    sum += tr;
    count += 1;
  }
  return count === 0 ? 0 : sum / count;
}
