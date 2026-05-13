import { barRange } from "@alea/lib/filters/_barMath";
import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { z } from "zod";

const configSchema = z.object({
  length: z.number().int().positive().default(5),
  threshold: z.number().positive().default(0.5),
});
type Config = z.infer<typeof configSchema>;

export const balanceOfPowerMeanrev: Filter<Config> = {
  id: "balance_of_power_meanrev",
  version: 1,
  barSource: "pyth",
  family: "body_location_oscillator",
  description:
    "Balance of Power mean reversion. A strongly positive average BOP predicts DOWN; a strongly negative average predicts UP.",
  configSchema,
  requiredBars: (c) => c.length,
  predict: (config, bars) => {
    let sum = 0;
    for (let i = bars.length - config.length; i < bars.length; i += 1) {
      const bar = bars[i];
      if (bar === undefined) {
        return null;
      }
      const range = barRange(bar);
      sum += range <= 0 ? 0 : (bar.close - bar.open) / range;
    }
    const avg = sum / config.length;
    if (avg >= config.threshold) {
      return "down";
    }
    if (avg <= -config.threshold) {
      return "up";
    }
    return null;
  },
};

registerFilter({
  filter: balanceOfPowerMeanrev as Filter<unknown>,
  defaultConfigs: () => [
    { length: 3, threshold: 0.6 },
    { length: 5, threshold: 0.5 },
    { length: 10, threshold: 0.4 },
    { length: 14, threshold: 0.35 },
    { length: 20, threshold: 0.3 },
    { length: 3, threshold: 0.7 },
    { length: 5, threshold: 0.6 },
    { length: 2, threshold: 0.6 },
    { length: 7, threshold: 0.45 },
  ],
});
