import { closeLocation } from "@alea/lib/filters/_barMath";
import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeAtrSeries } from "@alea/lib/indicators/atr";
import { computeEmaSeries } from "@alea/lib/indicators/ema";
import { z } from "zod";

const configSchema = z.object({
  emaLength: z.number().int().positive().default(20),
  slopeLookback: z.number().int().positive().default(5),
  atrLength: z.number().int().positive().default(14),
  minSlopePct: z.number().nonnegative().default(0.001),
  maxPullbackAtr: z.number().nonnegative().default(0.3),
  minCloseLocation: z.number().min(0).max(1).default(0.6),
});
type Config = z.infer<typeof configSchema>;

export const emaPullbackTrendFollow: Filter<Config> = {
  id: "ema_pullback_trend_follow",
  version: 1,
  family: "trend_pullback_continuation",
  description:
    "Follows EMA-trend pullback recoveries. A sloped EMA defines trend; a latest retest near the EMA that closes back in trend direction predicts continuation.",
  configSchema,
  requiredBars: (c) =>
    Math.max(c.emaLength + c.slopeLookback + 1, c.atrLength + 2),
  predict: (config, bars) => {
    const n = bars.length;
    const latest = bars[n - 1];
    if (latest === undefined) {
      return null;
    }
    const closes = bars.map((b) => b.close);
    const ema = computeEmaSeries({ closes, period: config.emaLength });
    const currentEma = ema[n - 1];
    const slopeBase = ema[n - 1 - config.slopeLookback];
    if (
      currentEma === null ||
      currentEma === undefined ||
      slopeBase === null ||
      slopeBase === undefined ||
      slopeBase <= 0
    ) {
      return null;
    }
    const highs = bars.map((b) => b.high);
    const lows = bars.map((b) => b.low);
    const atr = computeAtrSeries({
      highs,
      lows,
      closes,
      period: config.atrLength,
    })[n - 2];
    const location = closeLocation(latest);
    if (atr === null || atr === undefined || atr <= 0 || location === null) {
      return null;
    }
    const slopePct = (currentEma - slopeBase) / slopeBase;
    const maxPullback = config.maxPullbackAtr * atr;
    if (
      slopePct >= config.minSlopePct &&
      Math.abs(latest.low - currentEma) <= maxPullback &&
      latest.close > currentEma &&
      latest.close > latest.open &&
      location >= config.minCloseLocation
    ) {
      return "up";
    }
    if (
      slopePct <= -config.minSlopePct &&
      Math.abs(latest.high - currentEma) <= maxPullback &&
      latest.close < currentEma &&
      latest.close < latest.open &&
      location <= 1 - config.minCloseLocation
    ) {
      return "down";
    }
    return null;
  },
};

registerFilter({
  filter: emaPullbackTrendFollow as Filter<unknown>,
  defaultConfigs: () => [
    {
      emaLength: 20,
      slopeLookback: 5,
      atrLength: 14,
      minSlopePct: 0.001,
      maxPullbackAtr: 0.3,
      minCloseLocation: 0.6,
    },
    {
      emaLength: 20,
      slopeLookback: 5,
      atrLength: 14,
      minSlopePct: 0.002,
      maxPullbackAtr: 0.2,
      minCloseLocation: 0.65,
    },
    {
      emaLength: 50,
      slopeLookback: 10,
      atrLength: 14,
      minSlopePct: 0.0025,
      maxPullbackAtr: 0.4,
      minCloseLocation: 0.6,
    },
    {
      emaLength: 14,
      slopeLookback: 3,
      atrLength: 7,
      minSlopePct: 0.001,
      maxPullbackAtr: 0.25,
      minCloseLocation: 0.7,
    },
    {
      emaLength: 34,
      slopeLookback: 8,
      atrLength: 14,
      minSlopePct: 0.002,
      maxPullbackAtr: 0.3,
      minCloseLocation: 0.65,
    },
  ],
});
