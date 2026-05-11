import {
  bodyFraction,
  closeLocation,
} from "@alea/lib/filters/_barMath";
import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { z } from "zod";

const configSchema = z.object({
  insideBars: z.number().int().positive().default(1),
  minBodyFraction: z.number().min(0).max(1).default(0.5),
  minCloseLocation: z.number().min(0).max(1).default(0.7),
});
type Config = z.infer<typeof configSchema>;

export const insideBarBreakoutFollow: Filter<Config> = {
  id: "inside_bar_breakout_follow",
  version: 1,
  family: "compression_continuation",
  description:
    "Continuation after inside-bar compression. When the latest decisive candle breaks the mother bar high, predict UP; a decisive break below the mother low predicts DOWN.",
  configSchema,
  requiredBars: (c) => c.insideBars + 2,
  predict: (config, bars) => {
    const n = bars.length;
    const latest = bars[n - 1];
    const mother = bars[n - config.insideBars - 2];
    if (latest === undefined || mother === undefined) {
      return null;
    }
    for (let i = n - config.insideBars - 1; i <= n - 2; i += 1) {
      const inside = bars[i];
      if (
        inside === undefined ||
        inside.high > mother.high ||
        inside.low < mother.low
      ) {
        return null;
      }
    }
    const body = bodyFraction(latest);
    const location = closeLocation(latest);
    if (body === null || location === null || body < config.minBodyFraction) {
      return null;
    }
    if (latest.close > mother.high && location >= config.minCloseLocation) {
      return "up";
    }
    if (
      latest.close < mother.low &&
      location <= 1 - config.minCloseLocation
    ) {
      return "down";
    }
    return null;
  },
};

registerFilter({
  filter: insideBarBreakoutFollow as Filter<unknown>,
  defaultConfigs: () => [
    { insideBars: 1, minBodyFraction: 0.5, minCloseLocation: 0.7 },
    { insideBars: 1, minBodyFraction: 0.6, minCloseLocation: 0.75 },
    { insideBars: 2, minBodyFraction: 0.5, minCloseLocation: 0.7 },
    { insideBars: 3, minBodyFraction: 0.4, minCloseLocation: 0.7 },
    { insideBars: 2, minBodyFraction: 0.6, minCloseLocation: 0.8 },
  ],
});

