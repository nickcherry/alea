/**
 * Wilder's Relative Strength Index, the canonical RSI formula
 * tradingview's `ta.rsi` and most stockmarket textbooks use:
 *
 *   RSI_i = 100 − 100 / (1 + RS_i)
 *
 * where `RS_i = avgGain_i / avgLoss_i` over a `period`-length rolling
 * window of close-to-close changes, smoothed with Wilder's recursion
 * (the seed average over the first N gains/losses, then
 * `avg_i = ((N-1) · avg_{i-1} + new_i) / N` — equivalent to an EMA
 * with alpha = 1/N).
 *
 * Returns one entry per input close. `out[i]` is the RSI evaluated
 * through and including bar `i`. The first usable index is `period`
 * (need N price diffs); earlier indices are `null`. When `avgLoss`
 * collapses to zero we return 100, mirroring tradingview's
 * "infinite RS" treatment.
 *
 * Pure: takes a closed-bar close array, returns a same-length series.
 * No side effects, no hidden state — safe to call from training,
 * the snapshot pipeline, or per-bar divergence detection.
 */
export function computeWilderRsiSeries({
  closes,
  period,
}: {
  readonly closes: readonly number[];
  readonly period: number;
}): (number | null)[] {
  const out: (number | null)[] = new Array<number | null>(closes.length).fill(
    null,
  );
  if (closes.length <= period) {
    return out;
  }
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i += 1) {
    const a = closes[i - 1];
    const b = closes[i];
    if (a === undefined || b === undefined) {
      return out;
    }
    const diff = b - a;
    if (diff >= 0) {
      gainSum += diff;
    } else {
      lossSum -= diff;
    }
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  out[period] = rsiOf({ avgGain, avgLoss });
  for (let i = period + 1; i < closes.length; i += 1) {
    const a = closes[i - 1];
    const b = closes[i];
    if (a === undefined || b === undefined) {
      continue;
    }
    const diff = b - a;
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = rsiOf({ avgGain, avgLoss });
  }
  return out;
}

function rsiOf({
  avgGain,
  avgLoss,
}: {
  readonly avgGain: number;
  readonly avgLoss: number;
}): number {
  if (avgLoss === 0) {
    return 100;
  }
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}
