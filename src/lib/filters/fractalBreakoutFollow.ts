import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter, FilterBar } from "@alea/lib/filters/types";
import { computeAtrSeries } from "@alea/lib/indicators/atr";
import { z } from "zod";

const configSchema = z.object({
  pivotWidth: z.number().int().positive().default(2),
  maxPivotAge: z.number().int().positive().default(50),
  atrLength: z.number().int().positive().default(14),
  minBreakAtr: z.number().nonnegative().default(0),
});
type Config = z.infer<typeof configSchema>;

export const fractalBreakoutFollow: Filter<Config> = {
  id: "fractal_breakout_follow",
  version: 1,
  family: "swing_structure_continuation",
  description:
    "Follows breaks of confirmed swing pivots. A latest close above the most recent swing high predicts UP; a close below the most recent swing low predicts DOWN.",
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
    if (atr === null || atr === undefined || atr <= 0) {
      return null;
    }
    const minBreak = config.minBreakAtr * atr;
    if (pivotHigh !== null && latest.close - pivotHigh.value >= minBreak) {
      return "up";
    }
    if (pivotLow !== null && pivotLow.value - latest.close >= minBreak) {
      return "down";
    }
    return null;
  },
};

registerFilter({
  filter: fractalBreakoutFollow as Filter<unknown>,
  defaultConfigs: () => [
    { pivotWidth: 2, maxPivotAge: 50, atrLength: 14, minBreakAtr: 0 },
    { pivotWidth: 2, maxPivotAge: 100, atrLength: 14, minBreakAtr: 0.05 },
    { pivotWidth: 3, maxPivotAge: 100, atrLength: 14, minBreakAtr: 0.05 },
    { pivotWidth: 4, maxPivotAge: 150, atrLength: 20, minBreakAtr: 0.1 },
    { pivotWidth: 2, maxPivotAge: 30, atrLength: 7, minBreakAtr: 0.03 },
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
