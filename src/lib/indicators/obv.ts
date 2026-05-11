export function computeObvSeries({
  closes,
  volumes,
}: {
  readonly closes: readonly number[];
  readonly volumes: readonly number[];
}): number[] {
  const n = closes.length;
  if (volumes.length !== n) {
    throw new Error(`obv closes/volumes length mismatch (${n}/${volumes.length})`);
  }
  const out = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i += 1) {
    const close = closes[i];
    const previousClose = closes[i - 1];
    const volume = volumes[i] ?? 0;
    if (close === undefined || previousClose === undefined) {
      out[i] = out[i - 1] ?? 0;
      continue;
    }
    const prior = out[i - 1] ?? 0;
    if (close > previousClose) {
      out[i] = prior + volume;
    } else if (close < previousClose) {
      out[i] = prior - volume;
    } else {
      out[i] = prior;
    }
  }
  return out;
}

