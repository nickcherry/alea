export function computeEfficiencyRatio({
  closes,
  endIndex,
  length,
}: {
  readonly closes: readonly number[];
  readonly endIndex: number;
  readonly length: number;
}): number | null {
  const start = endIndex - length;
  const first = closes[start];
  const last = closes[endIndex];
  if (length <= 0 || first === undefined || last === undefined) {
    return null;
  }
  let path = 0;
  for (let i = start + 1; i <= endIndex; i += 1) {
    const current = closes[i];
    const previous = closes[i - 1];
    if (current === undefined || previous === undefined) {
      return null;
    }
    path += Math.abs(current - previous);
  }
  if (path <= 0) {
    return null;
  }
  return Math.abs(last - first) / path;
}

