import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeRollingVwapZSeries } from "@alea/lib/indicators/vwap";
import { z } from "zod";

const configSchema = z.object({
  length: z.number().int().positive().default(20),
  threshold: z.number().positive().default(2.5),
});
type Config = z.infer<typeof configSchema>;

export const vwapZscoreReversion: Filter<Config> = {
  id: "vwap_zscore_reversion",
  version: 1,
  family: "volume_weighted_reversion",
  description:
    "Mean reversion on close distance from rolling VWAP in volume-weighted standard deviations. High positive z predicts DOWN; high negative z predicts UP.",
  configSchema,
  requiredBars: (c) => c.length,
  predict: (config, bars) => {
    const closes = bars.map((b) => b.close);
    const volumes = bars.map((b) => b.volume);
    const { z: zscores } = computeRollingVwapZSeries({
      closes,
      volumes,
      period: config.length,
    });
    const zscore = zscores[zscores.length - 1];
    if (zscore === null || zscore === undefined) {
      return null;
    }
    if (zscore >= config.threshold) {
      return "down";
    }
    if (zscore <= -config.threshold) {
      return "up";
    }
    return null;
  },
};

registerFilter({
  filter: vwapZscoreReversion as Filter<unknown>,
  defaultConfigs: () => [
    { length: 20, threshold: 2.5 },
    { length: 20, threshold: 3 },
    { length: 50, threshold: 2.2 },
    { length: 14, threshold: 2 },
    { length: 30, threshold: 2.5 },
  ],
});

