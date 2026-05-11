/**
 * Average True Range, Wilder's original definition.
 *
 *   TR_i  = max( high - low,
 *                |high - prev_close|,
 *                |low  - prev_close| )
 *   ATR_i = Wilder-smoothed average of TR over `period` bars
 *
 * Wilder smoothing is the same recurrence as Wilder RSI:
 *   ATR_i = ((period - 1) * ATR_{i-1} + TR_i) / period
 * seeded with the simple mean of the first `period` TR values.
 *
 * Returns one entry per input bar. `out[i]` is the ATR through and
 * including bar `i`; the first usable index is `period`, earlier
 * indices are `null` (TR needs a prior close, and the seed needs
 * `period` TR values).
 *
 * Pure: takes bar OHLC arrays, returns a same-length series. No
 * hidden state, safe to call from anywhere.
 */
export function computeAtrSeries({
  highs,
  lows,
  closes,
  period,
}: {
  readonly highs: readonly number[];
  readonly lows: readonly number[];
  readonly closes: readonly number[];
  readonly period: number;
}): (number | null)[] {
  if (period <= 0) {
    throw new Error(`atr period must be > 0 (got ${period})`);
  }
  const n = closes.length;
  if (highs.length !== n || lows.length !== n) {
    throw new Error(
      `atr highs/lows/closes length mismatch (${highs.length}/${lows.length}/${n})`,
    );
  }
  const out: (number | null)[] = new Array<number | null>(n).fill(null);
  if (n <= period) {
    return out;
  }
  const tr = new Array<number>(n).fill(0);
  // TR for bar 0 has no prior close, so we use the bar's own range
  // — same convention as TradingView's `ta.tr(true)`. It's only used
  // to seed the average and falls out of the recursion within a
  // `period` bars.
  tr[0] = (highs[0] ?? 0) - (lows[0] ?? 0);
  for (let i = 1; i < n; i += 1) {
    const h = highs[i];
    const l = lows[i];
    const pc = closes[i - 1];
    if (h === undefined || l === undefined || pc === undefined) {
      tr[i] = 0;
      continue;
    }
    tr[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }
  let sum = 0;
  for (let i = 0; i < period; i += 1) {
    sum += tr[i] ?? 0;
  }
  let atr = sum / period;
  out[period - 1] = atr;
  for (let i = period; i < n; i += 1) {
    atr = (atr * (period - 1) + (tr[i] ?? 0)) / period;
    out[i] = atr;
  }
  return out;
}
