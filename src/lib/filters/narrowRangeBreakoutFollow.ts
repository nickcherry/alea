import {
  barRange,
  bodyFraction,
  closeLocation,
} from "@alea/lib/filters/_barMath";
import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeAtrSeries } from "@alea/lib/indicators/atr";
import { z } from "zod";

const configSchema = z.object({
  nrLookback: z.number().int().positive().default(7),
  atrLength: z.number().int().positive().default(14),
  minBreakAtr: z.number().nonnegative().default(0.02),
  minBodyFraction: z.number().min(0).max(1).default(0.5),
  minCloseLocation: z.number().min(0).max(1).default(0.7),
});
type Config = z.infer<typeof configSchema>;

export const narrowRangeBreakoutFollow: Filter<Config> = {
  id: "narrow_range_breakout_follow",
  version: 2,
  family: "compression_continuation",
  description:
    "Continuation after a narrow-range pause. If the prior candle is the narrowest in `nrLookback` bars and the latest candle breaks it decisively, follow the breakout direction.",
  configSchema,
  requiredBars: (c) => Math.max(c.nrLookback + 1, c.atrLength + 2),
  predict: (config, bars) => {
    const n = bars.length;
    const latest = bars[n - 1];
    const prior = bars[n - 2];
    if (latest === undefined || prior === undefined) {
      return null;
    }
    const priorRange = barRange(prior);
    if (priorRange <= 0) {
      return null;
    }
    for (let i = n - 1 - config.nrLookback; i <= n - 2; i += 1) {
      const bar = bars[i];
      if (bar === undefined) {
        return null;
      }
      if (barRange(bar) < priorRange) {
        return null;
      }
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
    const location = closeLocation(latest);
    const body = bodyFraction(latest);
    if (
      atr === null ||
      atr === undefined ||
      atr <= 0 ||
      location === null ||
      body === null ||
      body < config.minBodyFraction
    ) {
      return null;
    }
    const minBreak = config.minBreakAtr * atr;
    if (
      latest.close - prior.high >= minBreak &&
      location >= config.minCloseLocation
    ) {
      return "up";
    }
    if (
      prior.low - latest.close >= minBreak &&
      location <= 1 - config.minCloseLocation
    ) {
      return "down";
    }
    return null;
  },
};

registerFilter({
  filter: narrowRangeBreakoutFollow as Filter<unknown>,
  defaultConfigs: () => [
    {
      nrLookback: 4,
      atrLength: 14,
      minBreakAtr: 0.02,
      minBodyFraction: 0.4,
      minCloseLocation: 0.7,
    },
    {
      nrLookback: 7,
      atrLength: 14,
      minBreakAtr: 0.02,
      minBodyFraction: 0.5,
      minCloseLocation: 0.7,
    },
    {
      nrLookback: 7,
      atrLength: 7,
      minBreakAtr: 0.05,
      minBodyFraction: 0.5,
      minCloseLocation: 0.75,
    },
    {
      nrLookback: 10,
      atrLength: 14,
      minBreakAtr: 0.05,
      minBodyFraction: 0.5,
      minCloseLocation: 0.75,
    },
    {
      nrLookback: 14,
      atrLength: 14,
      minBreakAtr: 0.03,
      minBodyFraction: 0.4,
      minCloseLocation: 0.8,
    },
  ],
});
