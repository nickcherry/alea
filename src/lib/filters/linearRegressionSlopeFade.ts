import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { z } from "zod";

/**
 * Linear regression slope fade. Fits an OLS line to the trailing N
 * closes and fades a strong slope:
 *
 *   slope_per_bar / mean_close  ≥ +threshold   →  DOWN
 *   slope_per_bar / mean_close  ≤ -threshold   →  UP
 *
 * Slope normalized by mean price so the threshold is invariant to
 * the asset's price scale. Tests whether sustained directional
 * "trendiness" (as captured by a fitted line) predicts reversion.
 */
const configSchema = z.object({
  length: z.number().int().positive().default(20),
  threshold: z.number().positive().default(0.0005),
});
type Config = z.infer<typeof configSchema>;

export const linearRegressionSlopeFade: Filter<Config> = {
  id: "linear_regression_slope_fade",
  version: 1,
  family: "velocity_fade",
  description:
    "Fades strong linear-regression slopes. Fits an OLS line to the last N closes; if |slope| / mean_close exceeds the threshold, predict the opposite direction. Tests whether sustained 'trendiness' captured by a regression line mean-reverts.",
  configSchema,
  requiredBars: (c) => c.length + 1,
  predict: (config, bars) => {
    const n = bars.length;
    const N = config.length;
    if (n < N) {
      return null;
    }
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumXX = 0;
    for (let k = 0; k < N; k += 1) {
      const y = bars[n - N + k]?.close;
      if (y === undefined) {
        return null;
      }
      const x = k;
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumXX += x * x;
    }
    const denom = N * sumXX - sumX * sumX;
    if (denom <= 0) {
      return null;
    }
    const slope = (N * sumXY - sumX * sumY) / denom;
    const meanClose = sumY / N;
    if (meanClose <= 0) {
      return null;
    }
    const normSlope = slope / meanClose;
    if (normSlope >= config.threshold) {
      return "down";
    }
    if (normSlope <= -config.threshold) {
      return "up";
    }
    return null;
  },
};

registerFilter({
  filter: linearRegressionSlopeFade as Filter<unknown>,
  defaultConfigs: () => [
    { length: 10, threshold: 0.0005 },
    { length: 20, threshold: 0.001 },
    { length: 20, threshold: 0.0005 },
    { length: 20, threshold: 0.002 },
    { length: 50, threshold: 0.0005 },
  ],
});
