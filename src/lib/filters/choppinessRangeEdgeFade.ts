import {
  highestHigh,
  lowestLow,
} from "@alea/lib/filters/_barMath";
import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeChoppinessSeries } from "@alea/lib/indicators/choppiness";
import { z } from "zod";

const configSchema = z.object({
  length: z.number().int().positive().default(14),
  chopMin: z.number().nonnegative().default(61.8),
  edgeLookback: z.number().int().positive().default(20),
  edgePercentile: z.number().min(50).max(100).default(90),
});
type Config = z.infer<typeof configSchema>;

export const choppinessRangeEdgeFade: Filter<Config> = {
  id: "choppiness_range_edge_fade",
  version: 1,
  family: "range_reversion",
  description:
    "Range-edge fade gated by Choppiness Index. In choppy conditions, closes near the recent high predict DOWN and closes near the recent low predict UP.",
  configSchema,
  requiredBars: (c) => Math.max(c.length + 1, c.edgeLookback),
  predict: (config, bars) => {
    const highs = bars.map((b) => b.high);
    const lows = bars.map((b) => b.low);
    const closes = bars.map((b) => b.close);
    const i = bars.length - 1;
    const chop = computeChoppinessSeries({
      highs,
      lows,
      closes,
      period: config.length,
    })[i];
    if (chop === null || chop === undefined || chop < config.chopMin) {
      return null;
    }
    const high = highestHigh({
      bars,
      start: bars.length - config.edgeLookback,
      endExclusive: bars.length,
    });
    const low = lowestLow({
      bars,
      start: bars.length - config.edgeLookback,
      endExclusive: bars.length,
    });
    const close = closes[i];
    if (high === null || low === null || close === undefined || high <= low) {
      return null;
    }
    const location = (100 * (close - low)) / (high - low);
    if (location >= config.edgePercentile) {
      return "down";
    }
    if (location <= 100 - config.edgePercentile) {
      return "up";
    }
    return null;
  },
};

registerFilter({
  filter: choppinessRangeEdgeFade as Filter<unknown>,
  defaultConfigs: () => [
    { length: 14, chopMin: 61.8, edgeLookback: 20, edgePercentile: 90 },
    { length: 14, chopMin: 55, edgeLookback: 20, edgePercentile: 85 },
    { length: 20, chopMin: 61.8, edgeLookback: 30, edgePercentile: 90 },
    { length: 10, chopMin: 60, edgeLookback: 14, edgePercentile: 85 },
    { length: 30, chopMin: 55, edgeLookback: 50, edgePercentile: 90 },
  ],
});

