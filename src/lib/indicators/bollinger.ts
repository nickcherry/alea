import { computeSmaSeries } from "@alea/lib/indicators/sma";

/**
 * Bollinger Bands over a closing-price series.
 *
 *   middle_i  = SMA(closes, period)
 *   stddev_i  = population standard deviation of closes[i-period+1..i]
 *   upper_i   = middle_i + multiplier * stddev_i
 *   lower_i   = middle_i - multiplier * stddev_i
 *
 * `multiplier` defaults to 2 (the textbook setting). Returns parallel
 * arrays — same length as input, `null` before the first usable
 * index (`period - 1`).
 *
 * Implementation note: the textbook bollinger uses sample std-dev
 * (divide by `period - 1`); some platforms use population std-dev
 * (divide by `period`). We use population — matches TradingView's
 * `ta.stdev` default with the bias correction off and keeps the
 * math one line shorter. The difference is invisible at any practical
 * `period` (≥ 20).
 */
export function computeBollingerSeries({
  closes,
  period,
  multiplier = 2,
}: {
  readonly closes: readonly number[];
  readonly period: number;
  readonly multiplier?: number;
}): {
  readonly middle: readonly (number | null)[];
  readonly upper: readonly (number | null)[];
  readonly lower: readonly (number | null)[];
  readonly stddev: readonly (number | null)[];
} {
  const middle = computeSmaSeries({ closes, period });
  const upper: (number | null)[] = new Array<number | null>(closes.length).fill(
    null,
  );
  const lower: (number | null)[] = new Array<number | null>(closes.length).fill(
    null,
  );
  const stddev: (number | null)[] = new Array<number | null>(
    closes.length,
  ).fill(null);
  for (let i = period - 1; i < closes.length; i += 1) {
    const mean = middle[i];
    if (mean === null || mean === undefined) {
      continue;
    }
    let sqDiffSum = 0;
    for (let j = i - period + 1; j <= i; j += 1) {
      const v = closes[j];
      if (v === undefined) {
        continue;
      }
      const d = v - mean;
      sqDiffSum += d * d;
    }
    const sd = Math.sqrt(sqDiffSum / period);
    stddev[i] = sd;
    upper[i] = mean + multiplier * sd;
    lower[i] = mean - multiplier * sd;
  }
  return { middle, upper, lower, stddev };
}
