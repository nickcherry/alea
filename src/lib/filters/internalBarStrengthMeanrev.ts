import { barRange, closeLocation } from "@alea/lib/filters/_barMath";
import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeAtrSeries } from "@alea/lib/indicators/atr";
import { z } from "zod";

const configSchema = z.object({
  ibsLength: z.number().int().positive().default(1),
  lower: z.number().min(0).max(1).default(0.1),
  upper: z.number().min(0).max(1).default(0.9),
  atrLength: z.number().int().positive().default(14),
  minRangeAtr: z.number().nonnegative().default(0.25),
});
type Config = z.infer<typeof configSchema>;

export const internalBarStrengthMeanrev: Filter<Config> = {
  id: "internal_bar_strength_meanrev",
  version: 1,
  barSource: "pyth",
  family: "candle_location_reversion",
  description:
    "Fades close-location extremes inside the bar range. Average Internal Bar Strength `(close - low) / (high - low)` over `ibsLength` bars at or below `lower` predicts UP; at or above `upper` predicts DOWN. Average range must clear `minRangeAtr * ATR` so tiny dojis don't trigger.",
  configSchema,
  requiredBars: (c) => Math.max(c.ibsLength, c.atrLength + 2),
  predict: (config, bars) => {
    const n = bars.length;
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
    let sumIbs = 0;
    let sumRange = 0;
    for (let i = n - config.ibsLength; i < n; i += 1) {
      const bar = bars[i];
      if (bar === undefined) {
        return null;
      }
      const loc = closeLocation(bar);
      if (loc === null) {
        return null;
      }
      sumIbs += loc;
      sumRange += barRange(bar);
    }
    const avgIbs = sumIbs / config.ibsLength;
    const avgRange = sumRange / config.ibsLength;
    if (avgRange < config.minRangeAtr * atr) {
      return null;
    }
    if (avgIbs <= config.lower) {
      return "up";
    }
    if (avgIbs >= config.upper) {
      return "down";
    }
    return null;
  },
};

registerFilter({
  filter: internalBarStrengthMeanrev as Filter<unknown>,
  defaultConfigs: () => [
    { ibsLength: 4, lower: 0.15, upper: 0.85, atrLength: 14, minRangeAtr: 0.2 },
    { ibsLength: 4, lower: 0.15, upper: 0.85, atrLength: 14, minRangeAtr: 0.3 },
    { ibsLength: 3, lower: 0.2, upper: 0.8, atrLength: 14, minRangeAtr: 0.2 },
    { ibsLength: 3, lower: 0.2, upper: 0.8, atrLength: 14, minRangeAtr: 0.3 },
    { ibsLength: 3, lower: 0.15, upper: 0.85, atrLength: 14, minRangeAtr: 0.2 },
    { ibsLength: 3, lower: 0.15, upper: 0.85, atrLength: 14, minRangeAtr: 0.3 },
    { ibsLength: 4, lower: 0.2, upper: 0.8, atrLength: 14, minRangeAtr: 0.2 },
    { ibsLength: 4, lower: 0.2, upper: 0.8, atrLength: 14, minRangeAtr: 0.3 },
    { ibsLength: 5, lower: 0.15, upper: 0.85, atrLength: 14, minRangeAtr: 0.3 },
  ],
});
