export function computeParabolicSarSeries({
  highs,
  lows,
  closes,
  step,
  maxStep,
}: {
  readonly highs: readonly number[];
  readonly lows: readonly number[];
  readonly closes: readonly number[];
  readonly step: number;
  readonly maxStep: number;
}): {
  readonly sar: readonly (number | null)[];
  readonly trend: readonly ("up" | "down" | null)[];
} {
  if (step <= 0 || maxStep <= 0) {
    throw new Error(`parabolic sar steps must be > 0`);
  }
  const n = closes.length;
  if (highs.length !== n || lows.length !== n) {
    throw new Error(
      `parabolic sar highs/lows/closes length mismatch (${highs.length}/${lows.length}/${n})`,
    );
  }
  const sar: (number | null)[] = new Array<number | null>(n).fill(null);
  const trend: ("up" | "down" | null)[] = new Array<"up" | "down" | null>(
    n,
  ).fill(null);
  if (n < 3) {
    return { sar, trend };
  }
  const firstClose = closes[0];
  const secondClose = closes[1];
  const firstHigh = highs[0];
  const secondHigh = highs[1];
  const firstLow = lows[0];
  const secondLow = lows[1];
  if (
    firstClose === undefined ||
    secondClose === undefined ||
    firstHigh === undefined ||
    secondHigh === undefined ||
    firstLow === undefined ||
    secondLow === undefined
  ) {
    return { sar, trend };
  }

  let isUptrend = secondClose >= firstClose;
  let currentSar = isUptrend ? Math.min(firstLow, secondLow) : Math.max(firstHigh, secondHigh);
  let extremePoint = isUptrend ? Math.max(firstHigh, secondHigh) : Math.min(firstLow, secondLow);
  let acceleration = step;
  trend[1] = isUptrend ? "up" : "down";
  sar[1] = currentSar;

  for (let i = 2; i < n; i += 1) {
    const high = highs[i];
    const low = lows[i];
    const priorHigh = highs[i - 1];
    const priorLow = lows[i - 1];
    const twoBackHigh = highs[i - 2];
    const twoBackLow = lows[i - 2];
    if (
      high === undefined ||
      low === undefined ||
      priorHigh === undefined ||
      priorLow === undefined ||
      twoBackHigh === undefined ||
      twoBackLow === undefined
    ) {
      continue;
    }

    let nextSar = currentSar + acceleration * (extremePoint - currentSar);
    if (isUptrend) {
      nextSar = Math.min(nextSar, priorLow, twoBackLow);
      if (low < nextSar) {
        isUptrend = false;
        currentSar = extremePoint;
        extremePoint = low;
        acceleration = step;
      } else {
        currentSar = nextSar;
        if (high > extremePoint) {
          extremePoint = high;
          acceleration = Math.min(acceleration + step, maxStep);
        }
      }
    } else {
      nextSar = Math.max(nextSar, priorHigh, twoBackHigh);
      if (high > nextSar) {
        isUptrend = true;
        currentSar = extremePoint;
        extremePoint = high;
        acceleration = step;
      } else {
        currentSar = nextSar;
        if (low < extremePoint) {
          extremePoint = low;
          acceleration = Math.min(acceleration + step, maxStep);
        }
      }
    }
    trend[i] = isUptrend ? "up" : "down";
    sar[i] = currentSar;
  }

  return { sar, trend };
}

