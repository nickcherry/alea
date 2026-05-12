import { barRange } from "@alea/lib/filters/_barMath";
import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter, FilterBar } from "@alea/lib/filters/types";
import { computeAtrSeries } from "@alea/lib/indicators/atr";
import { z } from "zod";

const configSchema = z.object({
  pivotWidth: z.number().int().positive().default(2),
  maxPivotAge: z.number().int().positive().default(50),
  atrLength: z.number().int().positive().default(14),
  minSweepAtr: z.number().nonnegative().default(0.05),
  minRejectionFrac: z.number().min(0).max(1).default(0.35),
});
type Config = z.infer<typeof configSchema>;

export const fractalRejectionFade: Filter<Config> = {
  id: "fractal_rejection_fade",
  version: 1,
  family: "swing_structure_reversion",
  description:
    "Fades rejected sweeps of confirmed swing pivots. A wick above a swing high that closes back below predicts DOWN; a wick below a swing low predicts UP.",
  configSchema,
  requiredBars: (c) =>
    Math.max(c.maxPivotAge + c.pivotWidth + 1, c.atrLength + 2),
  predict: (config, bars) => {
    const n = bars.length;
    const latest = bars[n - 1];
    if (latest === undefined) {
      return null;
    }
    const pivotHigh = findMostRecentPivot({
      bars,
      width: config.pivotWidth,
      maxAge: config.maxPivotAge,
      type: "high",
    });
    const pivotLow = findMostRecentPivot({
      bars,
      width: config.pivotWidth,
      maxAge: config.maxPivotAge,
      type: "low",
    });
    const highs = bars.map((b) => b.high);
    const lows = bars.map((b) => b.low);
    const closes = bars.map((b) => b.close);
    const atr = computeAtrSeries({
      highs,
      lows,
      closes,
      period: config.atrLength,
    })[n - 2];
    const range = barRange(latest);
    if (atr === null || atr === undefined || atr <= 0 || range <= 0) {
      return null;
    }
    const minSweep = config.minSweepAtr * atr;
    const upperRejection = (latest.high - latest.close) / range;
    const lowerRejection = (latest.close - latest.low) / range;
    if (
      pivotHigh !== null &&
      latest.high - pivotHigh.value >= minSweep &&
      latest.close < pivotHigh.value &&
      upperRejection >= config.minRejectionFrac
    ) {
      return "down";
    }
    if (
      pivotLow !== null &&
      pivotLow.value - latest.low >= minSweep &&
      latest.close > pivotLow.value &&
      lowerRejection >= config.minRejectionFrac
    ) {
      return "up";
    }
    return null;
  },
};

registerFilter({
  filter: fractalRejectionFade as Filter<unknown>,
  defaultConfigs: () => [
    {
      pivotWidth: 2,
      maxPivotAge: 50,
      atrLength: 14,
      minSweepAtr: 0.05,
      minRejectionFrac: 0.35,
    },
    {
      pivotWidth: 2,
      maxPivotAge: 100,
      atrLength: 14,
      minSweepAtr: 0.1,
      minRejectionFrac: 0.4,
    },
    {
      pivotWidth: 3,
      maxPivotAge: 100,
      atrLength: 14,
      minSweepAtr: 0.05,
      minRejectionFrac: 0.35,
    },
    {
      pivotWidth: 4,
      maxPivotAge: 150,
      atrLength: 20,
      minSweepAtr: 0.1,
      minRejectionFrac: 0.45,
    },
    {
      pivotWidth: 2,
      maxPivotAge: 30,
      atrLength: 7,
      minSweepAtr: 0.05,
      minRejectionFrac: 0.5,
    },
  ],
});

function findMostRecentPivot({
  bars,
  width,
  maxAge,
  type,
}: {
  readonly bars: readonly FilterBar[];
  readonly width: number;
  readonly maxAge: number;
  readonly type: "high" | "low";
}): { readonly index: number; readonly value: number } | null {
  const latestIndex = bars.length - 1;
  const newestConfirmed = latestIndex - width - 1;
  const oldest = Math.max(width, latestIndex - maxAge);
  for (let i = newestConfirmed; i >= oldest; i -= 1) {
    const bar = bars[i];
    if (bar === undefined) {
      continue;
    }
    const value = type === "high" ? bar.high : bar.low;
    let isPivot = true;
    for (let j = i - width; j <= i + width; j += 1) {
      if (j === i) {
        continue;
      }
      const other = bars[j];
      if (other === undefined) {
        isPivot = false;
        break;
      }
      if (type === "high" ? other.high >= value : other.low <= value) {
        isPivot = false;
        break;
      }
    }
    if (isPivot) {
      return { index: i, value };
    }
  }
  return null;
}
