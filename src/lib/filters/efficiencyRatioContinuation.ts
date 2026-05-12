import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeEfficiencyRatio } from "@alea/lib/indicators/efficiencyRatio";
import { z } from "zod";

const configSchema = z.object({
  length: z.number().int().positive().default(10),
  minER: z.number().min(0).max(1).default(0.65),
  minNetMovePct: z.number().positive().default(0.003),
});
type Config = z.infer<typeof configSchema>;

export const efficiencyRatioContinuation: Filter<Config> = {
  id: "efficiency_ratio_continuation",
  version: 1,
  family: "trend_quality",
  description:
    "Follows clean directional paths. If Kaufman's efficiency ratio is high and the net move over `length` bars clears `minNetMovePct`, predict continuation in that direction.",
  configSchema,
  requiredBars: (c) => c.length + 1,
  predict: (config, bars) => {
    const closes = bars.map((b) => b.close);
    const endIndex = closes.length - 1;
    const start = closes[endIndex - config.length];
    const end = closes[endIndex];
    if (start === undefined || end === undefined || start <= 0) {
      return null;
    }
    const er = computeEfficiencyRatio({
      closes,
      endIndex,
      length: config.length,
    });
    if (er === null || er < config.minER) {
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
  filter: efficiencyRatioContinuation as Filter<unknown>,
  defaultConfigs: () => [
    { length: 7, minER: 0.7, minNetMovePct: 0.002 },
    { length: 10, minER: 0.65, minNetMovePct: 0.003 },
    { length: 14, minER: 0.6, minNetMovePct: 0.004 },
    { length: 20, minER: 0.55, minNetMovePct: 0.005 },
    { length: 30, minER: 0.5, minNetMovePct: 0.007 },
  ],
});
