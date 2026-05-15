import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { z } from "zod";

/**
 * Linear regression channel reversion. Fits an OLS line to the
 * trailing N closes, then computes the std-dev of residuals.
 * Engages when the latest close sits more than `multiplier` × stddev
 * away from the regression line:
 *
 *   close_i ≥ line(i) + multiplier · stddev  →  DOWN
 *   close_i ≤ line(i) - multiplier · stddev  →  UP
 *
 * Tracks dynamic, trend-aware bands — when the market is trending,
 * the channel tilts with it (unlike Bollinger which always uses a
 * flat mean). Tests whether a trend-adjusted reversion baseline
 * carries any edge.
 */
const configSchema = z.object({
  length: z.number().int().positive().default(20),
  multiplier: z.number().positive().default(2),
});
type Config = z.infer<typeof configSchema>;

export const stdevChannelReversion: Filter<Config> = {
  id: "stdev_channel_reversion",
  version: 1,
  barSource: "pyth",
  family: "band_reversion",
  description:
    "Linear-regression-channel reversion. Fits OLS to trailing closes, computes residual std-dev; engages when the latest close clears `multiplier`σ of residuals. Trend-aware analog of Bollinger.",
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
    const intercept = (sumY - slope * sumX) / N;
    let sumSqRes = 0;
    for (let k = 0; k < N; k += 1) {
      const y = bars[n - N + k]!.close;
      const pred = intercept + slope * k;
      const r = y - pred;
      sumSqRes += r * r;
    }
    const stddev = Math.sqrt(sumSqRes / N);
    if (stddev <= 0) {
      return null;
    }
    const close = bars[n - 1]!.close;
    const lineAtLatest = intercept + slope * (N - 1);
    const dev = (close - lineAtLatest) / stddev;
    if (dev >= config.multiplier) {
      return "down";
    }
    if (dev <= -config.multiplier) {
      return "up";
    }
    return null;
  },
};

registerFilter({
  filter: stdevChannelReversion as Filter<unknown>,
  defaultConfigs: () => [
    { length: 20, multiplier: 2 },
    { length: 20, multiplier: 2.25 },
    { length: 30, multiplier: 2.5 },
    { length: 30, multiplier: 3 },
    { length: 30, multiplier: 2.25 },
    { length: 50, multiplier: 3 },
    { length: 50, multiplier: 2.25 },
    { length: 50, multiplier: 2.5 },
  ],
});
