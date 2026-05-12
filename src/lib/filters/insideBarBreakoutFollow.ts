import { bodyFraction, closeLocation } from "@alea/lib/filters/_barMath";
import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeAtrSeries } from "@alea/lib/indicators/atr";
import { z } from "zod";

const configSchema = z.object({
  insideBars: z.number().int().positive().default(1),
  atrLength: z.number().int().positive().default(14),
  minBreakAtr: z.number().nonnegative().default(0),
  minBodyFraction: z.number().min(0).max(1).default(0.5),
  minCloseLocation: z.number().min(0).max(1).default(0.7),
});
type Config = z.infer<typeof configSchema>;

export const insideBarBreakoutFollow: Filter<Config> = {
  id: "inside_bar_breakout_follow",
  version: 2,
  family: "compression_continuation",
  description:
    "Continuation after inside-bar compression. When the latest decisive candle breaks the mother bar high, predict UP; a decisive break below the mother low predicts DOWN.",
  configSchema,
  requiredBars: (c) => Math.max(c.insideBars + 2, c.atrLength + 2),
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
    const minBreak = config.minBreakAtr * atr;
    if (
      latest.close - mother.high >= minBreak &&
      location >= config.minCloseLocation
    ) {
      return "up";
    }
    if (
      mother.low - latest.close >= minBreak &&
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
    {
      insideBars: 1,
      atrLength: 14,
      minBreakAtr: 0,
      minBodyFraction: 0.5,
      minCloseLocation: 0.7,
    },
    {
      insideBars: 1,
      atrLength: 14,
      minBreakAtr: 0.02,
      minBodyFraction: 0.6,
      minCloseLocation: 0.75,
    },
    {
      insideBars: 2,
      atrLength: 14,
      minBreakAtr: 0,
      minBodyFraction: 0.5,
      minCloseLocation: 0.7,
    },
    {
      insideBars: 2,
      atrLength: 14,
      minBreakAtr: 0.05,
      minBodyFraction: 0.6,
      minCloseLocation: 0.8,
    },
    {
      insideBars: 3,
      atrLength: 14,
      minBreakAtr: 0,
      minBodyFraction: 0.4,
      minCloseLocation: 0.7,
    },
  ],
});
