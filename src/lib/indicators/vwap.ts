export function computeRollingVwapZSeries({
  closes,
  volumes,
  period,
}: {
  readonly closes: readonly number[];
  readonly volumes: readonly number[];
  readonly period: number;
}): {
  readonly vwap: readonly (number | null)[];
  readonly z: readonly (number | null)[];
} {
  if (period <= 0) {
    throw new Error(`vwap period must be > 0 (got ${period})`);
  }
  const n = closes.length;
  if (volumes.length !== n) {
    throw new Error(`vwap closes/volumes length mismatch (${n}/${volumes.length})`);
  }
  const vwap: (number | null)[] = new Array<number | null>(n).fill(null);
  const z: (number | null)[] = new Array<number | null>(n).fill(null);
  for (let i = period - 1; i < n; i += 1) {
    let volumeSum = 0;
    let priceVolumeSum = 0;
    for (let j = i - period + 1; j <= i; j += 1) {
      const close = closes[j];
      const volume = volumes[j];
      if (close === undefined || volume === undefined) {
        continue;
      }
      volumeSum += volume;
      priceVolumeSum += close * volume;
    }
    if (volumeSum <= 0) {
      continue;
    }
    const mean = priceVolumeSum / volumeSum;
    vwap[i] = mean;
    let varianceSum = 0;
    for (let j = i - period + 1; j <= i; j += 1) {
      const close = closes[j];
      const volume = volumes[j];
      if (close === undefined || volume === undefined) {
        continue;
      }
      const diff = close - mean;
      varianceSum += volume * diff * diff;
    }
    const stddev = Math.sqrt(varianceSum / volumeSum);
    if (stddev <= 0) {
      continue;
    }
    const close = closes[i];
    if (close === undefined) {
      continue;
    }
    z[i] = (close - mean) / stddev;
  }
  return { vwap, z };
}

