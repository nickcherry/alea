import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { z } from "zod";

/**
 * Non-parametric percent-rank mean reversion. For the latest close,
 * compute the percentile rank within the trailing `length` closes.
 * Engage UP at low ranks, DOWN at high ranks:
 *
 *   rank = (# of trailing closes ≤ current) / length × 100
 *   if  rank ≤ oversold      →  UP
 *   if  rank ≥ overbought    →  DOWN
 *
 * Distribution-free analog of the Stochastic oscillator that uses
 * closes only (not highs/lows) and operates on percentile rather
 * than range position. Robust to outliers (rank is bounded).
 */
const configSchema = z.object({
  length: z.number().int().positive().default(20),
  oversold: z.number().min(0).max(100).default(10),
  overbought: z.number().min(0).max(100).default(90),
});
type Config = z.infer<typeof configSchema>;

export const percentRankMeanRev: Filter<Config> = {
  id: "percent_rank_meanrev",
  version: 1,
  barSource: "pyth",
  family: "oscillator_reversion",
  description:
    "Percentile-rank mean reversion. Computes where the latest close sits in the trailing N-bar close distribution and engages on extremes. Distribution-free, robust to outliers, distinct from range-based Stochastic.",
  configSchema,
  requiredBars: (c) => c.length + 1,
  predict: (config, bars) => {
    const n = bars.length;
    const N = config.length;
    if (n < N) {
      return null;
    }
    const current = bars[n - 1]?.close;
    if (current === undefined) {
      return null;
    }
    let countLEQ = 0;
    for (let k = n - N; k <= n - 1; k += 1) {
      const c = bars[k]?.close;
      if (c === undefined) {
        return null;
      }
      if (c <= current) {
        countLEQ += 1;
      }
    }
    const rank = (countLEQ / N) * 100;
    if (rank <= config.oversold) {
      return "up";
    }
    if (rank >= config.overbought) {
      return "down";
    }
    return null;
  },
};

registerFilter({
  filter: percentRankMeanRev as Filter<unknown>,
  defaultConfigs: () => [
    { length: 30, oversold: 2, overbought: 98 },
    { length: 20, oversold: 2, overbought: 98 },
    { length: 30, oversold: 5, overbought: 95 },
    { length: 14, oversold: 5, overbought: 95 },
    { length: 14, oversold: 2, overbought: 98 },
    { length: 50, oversold: 2, overbought: 98 },
  ],
});
