import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeRollingVwapZSeries } from "@alea/lib/indicators/vwap";
import { z } from "zod";

const configSchema = z.object({
  length: z.number().int().positive().default(20),
  bandZ: z.number().positive().default(2),
  minOutsideBars: z.number().int().positive().default(1),
});
type Config = z.infer<typeof configSchema>;

export const vwapBandReclaim: Filter<Config> = {
  id: "vwap_band_reclaim",
  version: 1,
  barSource: "coinbase",
  family: "volume_weighted_reversion",
  description:
    "VWAP-band reclaim confirmation. After one or more closes outside a rolling VWAP z-band, a close back inside the band predicts continued reversion.",
  configSchema,
  requiredBars: (c) => c.length + c.minOutsideBars,
  predict: (config, bars) => {
    const closes = bars.map((b) => b.close);
    const volumes = bars.map((b) => b.volume);
    const { z: zscores } = computeRollingVwapZSeries({
      closes,
      volumes,
      period: config.length,
    });
    const latest = zscores[zscores.length - 1];
    if (latest === null || latest === undefined) {
      return null;
    }
    let upperOutside = true;
    let lowerOutside = true;
    for (let i = zscores.length - 1 - config.minOutsideBars; i <= zscores.length - 2; i += 1) {
      const zscore = zscores[i];
      if (zscore === null || zscore === undefined) {
        return null;
      }
      if (zscore < config.bandZ) {
        upperOutside = false;
      }
      if (zscore > -config.bandZ) {
        lowerOutside = false;
      }
    }
    if (upperOutside && latest < config.bandZ) {
      return "down";
    }
    if (lowerOutside && latest > -config.bandZ) {
      return "up";
    }
    return null;
  },
};

registerFilter({
  filter: vwapBandReclaim as Filter<unknown>,
  defaultConfigs: () => [
    { length: 20, bandZ: 2, minOutsideBars: 1 },
    { length: 20, bandZ: 2.5, minOutsideBars: 1 },
    { length: 14, bandZ: 2, minOutsideBars: 1 },
    { length: 50, bandZ: 2, minOutsideBars: 1 },
    { length: 50, bandZ: 2.5, minOutsideBars: 2 },
  ],
});

