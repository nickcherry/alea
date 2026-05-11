export function computeChoppinessSeries({
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
  if (period <= 1) {
    throw new Error(`choppiness period must be > 1 (got ${period})`);
  }
  const n = closes.length;
  if (highs.length !== n || lows.length !== n) {
    throw new Error(
      `choppiness highs/lows/closes length mismatch (${highs.length}/${lows.length}/${n})`,
    );
  }
  const out: (number | null)[] = new Array<number | null>(n).fill(null);
  const tr = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i += 1) {
    const high = highs[i];
    const low = lows[i];
    if (high === undefined || low === undefined) {
      continue;
    }
    const prevClose = i === 0 ? closes[i] : closes[i - 1];
    if (prevClose === undefined) {
      continue;
    }
    tr[i] = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
  }
  for (let i = period - 1; i < n; i += 1) {
    let trSum = 0;
    let highest = -Infinity;
    let lowest = Infinity;
    for (let j = i - period + 1; j <= i; j += 1) {
      trSum += tr[j] ?? 0;
      const high = highs[j];
      const low = lows[j];
      if (high === undefined || low === undefined) {
        continue;
      }
      highest = Math.max(highest, high);
      lowest = Math.min(lowest, low);
    }
    const span = highest - lowest;
    if (span <= 0 || trSum <= 0) {
      continue;
    }
    out[i] = (100 * Math.log10(trSum / span)) / Math.log10(period);
  }
  return out;
}

