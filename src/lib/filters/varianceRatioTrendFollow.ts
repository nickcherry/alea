import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { z } from "zod";

const configSchema = z.object({
  length: z.number().int().positive().default(20),
  lag: z.number().int().positive().default(2),
  minVR: z.number().positive().default(1.25),
  minNetMovePct: z.number().positive().default(0.003),
});
type Config = z.infer<typeof configSchema>;

export const varianceRatioTrendFollow: Filter<Config> = {
  id: "variance_ratio_trend_follow",
  version: 1,
  barSource: "pyth",
  family: "persistence_continuation",
  description:
    "Follows statistically persistent return paths. A high variance ratio indicates trend persistence; direction comes from the net move over the same window.",
  configSchema,
  requiredBars: (c) => c.length + c.lag + 1,
  predict: (config, bars) => {
    const closes = bars.map((b) => b.close);
    const n = closes.length;
    const start = closes[n - 1 - config.length];
    const end = closes[n - 1];
    if (start === undefined || end === undefined || start <= 0) {
      return null;
    }
    const oneStepReturns: number[] = [];
    for (let i = n - config.length; i < n; i += 1) {
      const current = closes[i];
      const previous = closes[i - 1];
      if (
        current === undefined ||
        previous === undefined ||
        current <= 0 ||
        previous <= 0
      ) {
        return null;
      }
      oneStepReturns.push(Math.log(current / previous));
    }
    const lagReturns: number[] = [];
    for (let i = n - config.length + config.lag; i < n; i += 1) {
      const current = closes[i];
      const previous = closes[i - config.lag];
      if (
        current === undefined ||
        previous === undefined ||
        current <= 0 ||
        previous <= 0
      ) {
        return null;
      }
      lagReturns.push(Math.log(current / previous));
    }
    const oneStepVariance = variance(oneStepReturns);
    const lagVariance = variance(lagReturns);
    if (
      oneStepVariance === null ||
      lagVariance === null ||
      oneStepVariance <= 0
    ) {
      return null;
    }
    const varianceRatio = lagVariance / (config.lag * oneStepVariance);
    if (varianceRatio < config.minVR) {
      return null;
    }
    const netMovePct = (end - start) / start;
    if (netMovePct >= config.minNetMovePct) {
      return "up";
    }
    if (netMovePct <= -config.minNetMovePct) {
      return "down";
    }
    return null;
  },
};

registerFilter({
  filter: varianceRatioTrendFollow as Filter<unknown>,
  defaultConfigs: () => [
    { length: 20, lag: 2, minVR: 1.25, minNetMovePct: 0.003 },
    { length: 30, lag: 2, minVR: 1.2, minNetMovePct: 0.004 },
    { length: 50, lag: 3, minVR: 1.15, minNetMovePct: 0.005 },
    { length: 20, lag: 3, minVR: 1.3, minNetMovePct: 0.003 },
    { length: 100, lag: 5, minVR: 1.1, minNetMovePct: 0.008 },
  ],
});

function variance(values: readonly number[]): number | null {
  if (values.length < 2) {
    return null;
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  let ss = 0;
  for (const value of values) {
    ss += (value - mean) ** 2;
  }
  return ss / (values.length - 1);
}
