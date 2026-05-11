import { computeAtrSeries } from "@alea/lib/indicators/atr";

export function computeSupertrendSeries({
  highs,
  lows,
  closes,
  atrLength,
  multiplier,
}: {
  readonly highs: readonly number[];
  readonly lows: readonly number[];
  readonly closes: readonly number[];
  readonly atrLength: number;
  readonly multiplier: number;
}): {
  readonly trend: readonly ("up" | "down" | null)[];
  readonly line: readonly (number | null)[];
} {
  const n = closes.length;
  if (highs.length !== n || lows.length !== n) {
    throw new Error(
      `supertrend highs/lows/closes length mismatch (${highs.length}/${lows.length}/${n})`,
    );
  }
  const atr = computeAtrSeries({ highs, lows, closes, period: atrLength });
  const trend: ("up" | "down" | null)[] = new Array<"up" | "down" | null>(
    n,
  ).fill(null);
  const line: (number | null)[] = new Array<number | null>(n).fill(null);
  let finalUpper: number | null = null;
  let finalLower: number | null = null;
  let currentTrend: "up" | "down" | null = null;

  for (let i = 0; i < n; i += 1) {
    const high = highs[i];
    const low = lows[i];
    const close = closes[i];
    const currentAtr = atr[i];
    if (
      high === undefined ||
      low === undefined ||
      close === undefined ||
      currentAtr === null ||
      currentAtr === undefined ||
      currentAtr <= 0
    ) {
      continue;
    }
    const hl2 = (high + low) / 2;
    const basicUpper = hl2 + multiplier * currentAtr;
    const basicLower = hl2 - multiplier * currentAtr;
    const previousClose = closes[i - 1];

    if (finalUpper === null || finalLower === null || previousClose === undefined) {
      finalUpper = basicUpper;
      finalLower = basicLower;
      currentTrend = close >= hl2 ? "up" : "down";
    } else {
      finalUpper =
        basicUpper < finalUpper || previousClose > finalUpper
          ? basicUpper
          : finalUpper;
      finalLower =
        basicLower > finalLower || previousClose < finalLower
          ? basicLower
          : finalLower;
      if (currentTrend === "down" && close > finalUpper) {
        currentTrend = "up";
      } else if (currentTrend === "up" && close < finalLower) {
        currentTrend = "down";
      }
    }

    trend[i] = currentTrend;
    line[i] = currentTrend === "up" ? finalLower : finalUpper;
  }

  return { trend, line };
}

