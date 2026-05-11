/**
 * Wilder ADX with +DI / -DI.
 *
 * `plusDi[i]`, `minusDi[i]`, and `adx[i]` are values through bar `i`.
 * ADX is null until enough DX values exist to seed Wilder's average.
 */
export function computeAdxSeries({
  highs,
  lows,
  closes,
  period,
}: {
  readonly highs: readonly number[];
  readonly lows: readonly number[];
  readonly closes: readonly number[];
  readonly period: number;
}): {
  readonly adx: readonly (number | null)[];
  readonly plusDi: readonly (number | null)[];
  readonly minusDi: readonly (number | null)[];
} {
  if (period <= 0) {
    throw new Error(`adx period must be > 0 (got ${period})`);
  }
  const n = closes.length;
  if (highs.length !== n || lows.length !== n) {
    throw new Error(
      `adx highs/lows/closes length mismatch (${highs.length}/${lows.length}/${n})`,
    );
  }
  const adx: (number | null)[] = new Array<number | null>(n).fill(null);
  const plusDi: (number | null)[] = new Array<number | null>(n).fill(null);
  const minusDi: (number | null)[] = new Array<number | null>(n).fill(null);
  if (n <= period) {
    return { adx, plusDi, minusDi };
  }

  const tr = new Array<number>(n).fill(0);
  const plusDm = new Array<number>(n).fill(0);
  const minusDm = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i += 1) {
    const high = highs[i];
    const low = lows[i];
    const prevHigh = highs[i - 1];
    const prevLow = lows[i - 1];
    const prevClose = closes[i - 1];
    if (
      high === undefined ||
      low === undefined ||
      prevHigh === undefined ||
      prevLow === undefined ||
      prevClose === undefined
    ) {
      continue;
    }
    const upMove = high - prevHigh;
    const downMove = prevLow - low;
    plusDm[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDm[i] = downMove > upMove && downMove > 0 ? downMove : 0;
    tr[i] = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
  }

  let smoothTr = 0;
  let smoothPlusDm = 0;
  let smoothMinusDm = 0;
  let adxSeedSum = 0;
  let adxSeedCount = 0;
  let prevAdx: number | null = null;

  for (let i = 1; i < n; i += 1) {
    if (i < period) {
      smoothTr += tr[i] ?? 0;
      smoothPlusDm += plusDm[i] ?? 0;
      smoothMinusDm += minusDm[i] ?? 0;
      continue;
    }
    if (i === period) {
      smoothTr += tr[i] ?? 0;
      smoothPlusDm += plusDm[i] ?? 0;
      smoothMinusDm += minusDm[i] ?? 0;
    } else {
      smoothTr = smoothTr - smoothTr / period + (tr[i] ?? 0);
      smoothPlusDm = smoothPlusDm - smoothPlusDm / period + (plusDm[i] ?? 0);
      smoothMinusDm =
        smoothMinusDm - smoothMinusDm / period + (minusDm[i] ?? 0);
    }
    if (smoothTr <= 0) {
      continue;
    }
    const plus = (100 * smoothPlusDm) / smoothTr;
    const minus = (100 * smoothMinusDm) / smoothTr;
    plusDi[i] = plus;
    minusDi[i] = minus;
    const denom = plus + minus;
    const dx = denom <= 0 ? 0 : (100 * Math.abs(plus - minus)) / denom;

    if (adxSeedCount < period) {
      adxSeedSum += dx;
      adxSeedCount += 1;
      if (adxSeedCount === period) {
        prevAdx = adxSeedSum / period;
        adx[i] = prevAdx;
      }
      continue;
    }
    if (prevAdx !== null) {
      prevAdx = (prevAdx * (period - 1) + dx) / period;
      adx[i] = prevAdx;
    }
  }

  return { adx, plusDi, minusDi };
}

