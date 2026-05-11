export function computeMfiSeries({
  highs,
  lows,
  closes,
  volumes,
  period,
}: {
  readonly highs: readonly number[];
  readonly lows: readonly number[];
  readonly closes: readonly number[];
  readonly volumes: readonly number[];
  readonly period: number;
}): (number | null)[] {
  if (period <= 0) {
    throw new Error(`mfi period must be > 0 (got ${period})`);
  }
  const n = closes.length;
  if (highs.length !== n || lows.length !== n || volumes.length !== n) {
    throw new Error(
      `mfi highs/lows/closes/volumes length mismatch (${highs.length}/${lows.length}/${n}/${volumes.length})`,
    );
  }
  const out: (number | null)[] = new Array<number | null>(n).fill(null);
  const positiveFlow = new Array<number>(n).fill(0);
  const negativeFlow = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i += 1) {
    const typical = typicalPrice({
      high: highs[i],
      low: lows[i],
      close: closes[i],
    });
    const previousTypical = typicalPrice({
      high: highs[i - 1],
      low: lows[i - 1],
      close: closes[i - 1],
    });
    const volume = volumes[i];
    if (typical === null || previousTypical === null || volume === undefined) {
      continue;
    }
    const flow = typical * volume;
    if (typical > previousTypical) {
      positiveFlow[i] = flow;
    } else if (typical < previousTypical) {
      negativeFlow[i] = flow;
    }
  }
  for (let i = period; i < n; i += 1) {
    let positive = 0;
    let negative = 0;
    for (let j = i - period + 1; j <= i; j += 1) {
      positive += positiveFlow[j] ?? 0;
      negative += negativeFlow[j] ?? 0;
    }
    if (negative <= 0) {
      out[i] = positive > 0 ? 100 : 50;
      continue;
    }
    const ratio = positive / negative;
    out[i] = 100 - 100 / (1 + ratio);
  }
  return out;
}

function typicalPrice({
  high,
  low,
  close,
}: {
  readonly high: number | undefined;
  readonly low: number | undefined;
  readonly close: number | undefined;
}): number | null {
  if (high === undefined || low === undefined || close === undefined) {
    return null;
  }
  return (high + low + close) / 3;
}

