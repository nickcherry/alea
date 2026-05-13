import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeAtrSeries } from "@alea/lib/indicators/atr";
import { z } from "zod";

const configSchema = z.object({
  count: z.number().int().min(2).default(3),
  atrLength: z.number().int().positive().default(14),
  minStepAtr: z.number().nonnegative().default(0.02),
  requireCloseConfirm: z.boolean().default(true),
});
type Config = z.infer<typeof configSchema>;

export const higherLowsLowerHighsFollow: Filter<Config> = {
  id: "higher_lows_lower_highs_follow",
  version: 1,
  barSource: "pyth",
  family: "micro_structure_continuation",
  description:
    "Follows short micro-structure pressure. Consecutive higher lows predict UP; consecutive lower highs predict DOWN, optionally requiring the latest close to confirm.",
  configSchema,
  requiredBars: (c) => Math.max(c.count, c.atrLength + 2),
  predict: (config, bars) => {
    const n = bars.length;
    const highs = bars.map((b) => b.high);
    const lows = bars.map((b) => b.low);
    const closes = bars.map((b) => b.close);
    const atr = computeAtrSeries({
      highs,
      lows,
      closes,
      period: config.atrLength,
    })[n - 2];
    if (atr === null || atr === undefined || atr <= 0) {
      return null;
    }
    const minStep = config.minStepAtr * atr;
    let higherLows = true;
    let lowerHighs = true;
    for (let i = n - config.count + 1; i < n; i += 1) {
      const current = bars[i];
      const previous = bars[i - 1];
      if (current === undefined || previous === undefined) {
        return null;
      }
      if (current.low - previous.low < minStep) {
        higherLows = false;
      }
      if (previous.high - current.high < minStep) {
        lowerHighs = false;
      }
    }
    const latest = bars[n - 1];
    const previous = bars[n - 2];
    if (latest === undefined || previous === undefined) {
      return null;
    }
    if (
      config.requireCloseConfirm &&
      higherLows &&
      latest.close <= previous.close
    ) {
      higherLows = false;
    }
    if (
      config.requireCloseConfirm &&
      lowerHighs &&
      latest.close >= previous.close
    ) {
      lowerHighs = false;
    }
    if (higherLows === lowerHighs) {
      return null;
    }
    return higherLows ? "up" : "down";
  },
};

registerFilter({
  filter: higherLowsLowerHighsFollow as Filter<unknown>,
  defaultConfigs: () => [
    { count: 3, atrLength: 14, minStepAtr: 0.02, requireCloseConfirm: true },
    { count: 4, atrLength: 14, minStepAtr: 0, requireCloseConfirm: true },
    { count: 5, atrLength: 14, minStepAtr: 0, requireCloseConfirm: false },
    { count: 3, atrLength: 7, minStepAtr: 0.05, requireCloseConfirm: true },
    { count: 4, atrLength: 20, minStepAtr: 0.03, requireCloseConfirm: true },
  ],
});
