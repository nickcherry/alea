/**
 * Commodity Channel Index, Lambert (1980).
 *
 *   tp_i  = (high_i + low_i + close_i) / 3                       (typical price)
 *   sma_i = SMA(tp, period)
 *   mad_i = mean(|tp[j] - sma_i|, j ∈ [i - period + 1, i])      (mean abs deviation)
 *   cci_i = (tp_i - sma_i) / (0.015 · mad_i)
 *
 * The `0.015` scaling constant is part of the canonical formula —
 * Lambert picked it so that ~70-80% of CCI readings fall in
 * `[-100, +100]` on most instruments, which is why those values are
 * the classic overbought/oversold thresholds.
 *
 * MAD (mean absolute deviation) is the third volatility measure we've
 * touched, after std-dev (Bollinger) and ATR (Keltner). Same general
 * shape — distance from a rolling mean divided by a rolling volatility
 * estimate — but MAD weights every bar's deviation linearly whereas
 * std-dev squares them. CCI side-by-side with Bollinger / Z-score
 * tells us whether the choice of volatility measure carries any
 * signal beyond "yes this is stretched".
 *
 * Returns one entry per input bar. `out[i]` is the CCI through and
 * including bar `i`; the first usable index is `period - 1`. A flat
 * window (MAD = 0) yields `null` rather than ±∞.
 */
export function computeCciSeries({
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
    throw new Error(`cci period must be > 0 (got ${period})`);
  }
  const n = closes.length;
  if (highs.length !== n || lows.length !== n) {
    throw new Error(
      `cci highs/lows/closes length mismatch (${highs.length}/${lows.length}/${n})`,
    );
  }
  const tp = new Array<number | null>(n).fill(null);
  for (let i = 0; i < n; i += 1) {
    const h = highs[i];
    const l = lows[i];
    const c = closes[i];
    if (h === undefined || l === undefined || c === undefined) {
      continue;
    }
    tp[i] = (h + l + c) / 3;
  }
  const out: (number | null)[] = new Array<number | null>(n).fill(null);
  for (let i = period - 1; i < n; i += 1) {
    let sum = 0;
    let ok = true;
    for (let j = i - period + 1; j <= i; j += 1) {
      const v = tp[j];
      if (v === null || v === undefined) {
        ok = false;
        break;
      }
      sum += v;
    }
    if (!ok) {
      continue;
    }
    const sma = sum / period;
    let madSum = 0;
    for (let j = i - period + 1; j <= i; j += 1) {
      const v = tp[j];
      if (v === null || v === undefined) {
        ok = false;
        break;
      }
      madSum += Math.abs(v - sma);
    }
    if (!ok) {
      continue;
    }
    const mad = madSum / period;
    const current = tp[i];
    if (mad <= 0 || current === null || current === undefined) {
      continue;
    }
    out[i] = (current - sma) / (0.015 * mad);
  }
  return out;
}
