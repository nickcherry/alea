import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { z } from "zod";

/**
 * Donchian channel reversion. Engage UP when the latest close is at
 * or below the lowest low of the trailing `period` bars, DOWN when
 * at or above the highest high. Raw-extreme reversion — no
 * volatility scaling, no smoothing — distinct from Bollinger /
 * Keltner / zscore which all anchor on a rolling mean.
 */
const configSchema = z.object({
  period: z.number().int().positive().default(20),
});
type Config = z.infer<typeof configSchema>;

export const donchianReversion: Filter<Config> = {
  id: "donchian_reversion",
  version: 1,
  barSource: "pyth",
  family: "band_reversion",
  description:
    "Engages UP when the latest close is at or below the trailing N-bar low, DOWN when at or above the trailing N-bar high. Pure raw-extreme channel reversion, no volatility scaling.",
  configSchema,
  requiredBars: (c) => c.period + 1,
  predict: (config, bars) => {
    const i = bars.length - 1;
    const close = bars[i]?.close;
    if (close === undefined) {
      return null;
    }
    let hi = -Infinity;
    let lo = Infinity;
    for (let k = i - config.period + 1; k <= i; k += 1) {
      const b = bars[k];
      if (b === undefined) {
        return null;
      }
      if (b.high > hi) {
        hi = b.high;
      }
      if (b.low < lo) {
        lo = b.low;
      }
    }
    if (!Number.isFinite(hi) || !Number.isFinite(lo)) {
      return null;
    }
    if (close <= lo) {
      return "up";
    }
    if (close >= hi) {
      return "down";
    }
    return null;
  },
};

registerFilter({
  filter: donchianReversion as Filter<unknown>,
  defaultConfigs: () => [
    { period: 30 },
    { period: 20 },
    { period: 14 },
    { period: 50 },
    { period: 10 },
  ],
});
