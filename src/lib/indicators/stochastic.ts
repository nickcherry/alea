import { computeSmaSeries } from "@alea/lib/indicators/sma";

/**
 * Stochastic oscillator %K, with optional SMA smoothing.
 *
 * Raw %K reads "where in the trailing `lookback`-bar high-low range
 * does the current close sit?":
 *
 *   %K_raw_i = 100 × (close_i - lowest_low_N) / (highest_high_N - lowest_low_N)
 *
 * where N = `lookback`. Range 0..100; 0 = at the period low, 100 =
 * at the period high. Degenerate windows (highest == lowest, i.e. a
 * dead-flat run) yield `null` rather than 50 — there's no signal
 * in a window with no movement.
 *
 * `smoothK` smooths the raw %K with an SMA of that length. Setting
 * `smoothK = 1` returns the raw value; the classic "Slow Stochastic"
 * uses `smoothK = 3`. We pass smoothK through this same function so
 * callers can pick raw or smoothed by config without branching at
 * the call site.
 *
 * The classic %D line (SMA of %K) isn't needed by any of our filters
 * yet; add a separate helper when one wants it.
 */
export function computeStochasticKSeries({
  highs,
  lows,
  closes,
  lookback,
  smoothK = 1,
}: {
  readonly highs: readonly number[];
  readonly lows: readonly number[];
  readonly closes: readonly number[];
  readonly lookback: number;
  readonly smoothK?: number;
}): (number | null)[] {
  if (lookback <= 0) {
    throw new Error(`stochastic lookback must be > 0 (got ${lookback})`);
  }
  if (smoothK <= 0) {
    throw new Error(`stochastic smoothK must be > 0 (got ${smoothK})`);
  }
  const n = closes.length;
  if (highs.length !== n || lows.length !== n) {
    throw new Error(
      `stochastic highs/lows/closes length mismatch (${highs.length}/${lows.length}/${n})`,
    );
  }
  const raw: (number | null)[] = new Array<number | null>(n).fill(null);
  for (let i = lookback - 1; i < n; i += 1) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - lookback + 1; j <= i; j += 1) {
      const h = highs[j];
      const l = lows[j];
      if (h === undefined || l === undefined) {
        continue;
      }
      if (h > hi) {
        hi = h;
      }
      if (l < lo) {
        lo = l;
      }
    }
    const c = closes[i];
    const range = hi - lo;
    if (c === undefined || !Number.isFinite(range) || range <= 0) {
      continue;
    }
    raw[i] = (100 * (c - lo)) / range;
  }
  if (smoothK <= 1) {
    return raw;
  }
  // SMA the raw %K. Reuse computeSmaSeries but it expects a number[]
  // — we drop the leading nulls in place by converting to 0 outside
  // the valid range and then masking the SMA result by raw[i].
  const filled = raw.map((v) => v ?? 0);
  const smoothed = computeSmaSeries({ closes: filled, period: smoothK });
  const out: (number | null)[] = new Array<number | null>(n).fill(null);
  for (let i = 0; i < n; i += 1) {
    if (raw[i] === null) {
      continue;
    }
    // The SMA at index `i` averages indices [i - smoothK + 1, i]; we
    // only treat the result as valid once every input in that window
    // has a non-null raw %K. The earliest such index is
    // `lookback - 1 + smoothK - 1`.
    if (i < lookback - 1 + smoothK - 1) {
      continue;
    }
    out[i] = smoothed[i] ?? null;
  }
  return out;
}
