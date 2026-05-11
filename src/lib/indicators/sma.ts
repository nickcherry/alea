/**
 * Simple moving average over a closing-price series.
 *
 *   sma_i = mean(closes[i - period + 1 .. i])
 *
 * Returns one entry per input close. `out[i]` is the SMA through
 * and including bar `i`; the first usable index is `period - 1`,
 * earlier indices are `null`.
 *
 * Rolling-window implementation: O(n) total, O(1) per step.
 */
export function computeSmaSeries({
  closes,
  period,
}: {
  readonly closes: readonly number[];
  readonly period: number;
}): (number | null)[] {
  if (period <= 0) {
    throw new Error(`sma period must be > 0 (got ${period})`);
  }
  const out: (number | null)[] = new Array<number | null>(closes.length).fill(
    null,
  );
  let sum = 0;
  for (let i = 0; i < closes.length; i += 1) {
    const v = closes[i];
    if (v === undefined) {
      continue;
    }
    sum += v;
    if (i >= period) {
      const drop = closes[i - period];
      if (drop !== undefined) {
        sum -= drop;
      }
    }
    if (i >= period - 1) {
      out[i] = sum / period;
    }
  }
  return out;
}
