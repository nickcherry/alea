/**
 * Aroon Up/Down/Oscillator. Time-domain momentum indicator —
 * measures how recently the rolling `period`-bar high (Up) and low
 * (Down) occurred, rather than how far price has moved:
 *
 *   AroonUp_i   = ((period - bars_since_high) / period) × 100
 *   AroonDown_i = ((period - bars_since_low)  / period) × 100
 *   AroonOsc_i  = AroonUp_i - AroonDown_i
 *
 * where `bars_since_high` is `i - argmax(highs[i-period..i])` and
 * similarly for the low. The window includes the current bar, so
 * `bars_since_high = 0` means "the current bar IS the high",
 * giving AroonUp = 100. AroonUp = 0 means the high was exactly
 * `period` bars ago (the oldest bar in the window).
 *
 * Different family from RSI / Stochastic / CCI:
 *
 *   - RSI normalizes against the period's gain/loss distribution.
 *   - Stoch normalizes against the period's price range.
 *   - CCI normalizes against the MAD of typical price.
 *   - Aroon ignores magnitudes entirely and only looks at *time
 *     since* the extreme — a pure ordinal read.
 *
 * Returns three parallel arrays. First usable index is `period`
 * (we need a full window of historical bars).
 */
export function computeAroonSeries({
  highs,
  lows,
  period,
}: {
  readonly highs: readonly number[];
  readonly lows: readonly number[];
  readonly period: number;
}): {
  readonly up: readonly (number | null)[];
  readonly down: readonly (number | null)[];
  readonly oscillator: readonly (number | null)[];
} {
  if (period <= 0) {
    throw new Error(`aroon period must be > 0 (got ${period})`);
  }
  const n = highs.length;
  if (lows.length !== n) {
    throw new Error(
      `aroon highs/lows length mismatch (${highs.length}/${lows.length})`,
    );
  }
  const up: (number | null)[] = new Array<number | null>(n).fill(null);
  const down: (number | null)[] = new Array<number | null>(n).fill(null);
  const oscillator: (number | null)[] = new Array<number | null>(n).fill(null);
  for (let i = period; i < n; i += 1) {
    let hi = -Infinity;
    let lo = Infinity;
    let hiIdx = i;
    let loIdx = i;
    for (let j = i - period; j <= i; j += 1) {
      const h = highs[j];
      const l = lows[j];
      if (h === undefined || l === undefined) {
        hi = -Infinity;
        break;
      }
      if (h > hi) {
        hi = h;
        hiIdx = j;
      }
      if (l < lo) {
        lo = l;
        loIdx = j;
      }
    }
    if (!Number.isFinite(hi)) {
      continue;
    }
    const barsSinceHigh = i - hiIdx;
    const barsSinceLow = i - loIdx;
    const u = ((period - barsSinceHigh) / period) * 100;
    const d = ((period - barsSinceLow) / period) * 100;
    up[i] = u;
    down[i] = d;
    oscillator[i] = u - d;
  }
  return { up, down, oscillator };
}
