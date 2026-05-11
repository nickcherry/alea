/**
 * Exponential moving average over a closing-price series.
 *
 *   ema_i = α · close_i + (1 − α) · ema_{i-1}
 *
 * with `α = 2 / (period + 1)` — the standard "smoothing factor"
 * TradingView, MetaTrader, and most textbooks use. The first
 * `period` indices are seeded with the SMA of `closes[0..period-1]`
 * so the early EMA values are well-defined without an asymptote
 * from zero; the recurrence above drives every index from `period`
 * onward.
 *
 * Returns one entry per input close. `out[i]` is the EMA through
 * and including bar `i`; the first usable index is `period - 1`,
 * earlier indices are `null`.
 */
export function computeEmaSeries({
  closes,
  period,
}: {
  readonly closes: readonly number[];
  readonly period: number;
}): (number | null)[] {
  if (period <= 0) {
    throw new Error(`ema period must be > 0 (got ${period})`);
  }
  const out: (number | null)[] = new Array<number | null>(closes.length).fill(
    null,
  );
  if (closes.length < period) {
    return out;
  }
  let seedSum = 0;
  for (let i = 0; i < period; i += 1) {
    const v = closes[i];
    if (v === undefined) {
      return out;
    }
    seedSum += v;
  }
  let ema = seedSum / period;
  out[period - 1] = ema;
  const alpha = 2 / (period + 1);
  for (let i = period; i < closes.length; i += 1) {
    const v = closes[i];
    if (v === undefined) {
      continue;
    }
    ema = alpha * v + (1 - alpha) * ema;
    out[i] = ema;
  }
  return out;
}
