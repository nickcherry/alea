/**
 * Wilson score interval for a binomial proportion at 95% confidence.
 *
 * Picked over the textbook normal-approximation because it stays well
 * behaved near 0% and 100% and at low sample counts — exactly the
 * regime a freshly-added candidate lives in until enough fires
 * accumulate. Formula reference: Wilson (1927); see also
 * https://en.wikipedia.org/wiki/Binomial_proportion_confidence_interval.
 *
 * For `n === 0` we return `[0, 1]` because there is literally no
 * information; the caller can treat that as "no CI to display".
 */
const Z_95 = 1.96;

export function wilsonInterval95({
  wins,
  n,
}: {
  readonly wins: number;
  readonly n: number;
}): { readonly low: number; readonly high: number } {
  if (n <= 0) {
    return { low: 0, high: 1 };
  }
  const p = wins / n;
  const z2 = Z_95 * Z_95;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const margin =
    (Z_95 * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return {
    low: Math.max(0, center - margin),
    high: Math.min(1, center + margin),
  };
}
