import { closeLocation } from "@alea/lib/filters/_barMath";
import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeAtrSeries } from "@alea/lib/indicators/atr";
import { computeSupertrendSeries } from "@alea/lib/indicators/supertrend";
import { z } from "zod";

const configSchema = z.object({
  atrLength: z.number().int().positive().default(10),
  multiplier: z.number().positive().default(3),
  maxDistanceAtr: z.number().nonnegative().default(0.25),
  minCloseLocation: z.number().min(0).max(1).default(0.6),
});
type Config = z.infer<typeof configSchema>;

export const supertrendRetestFollow: Filter<Config> = {
  id: "supertrend_retest_follow",
  version: 1,
  family: "trend_pullback_continuation",
  description:
    "Follows Supertrend pullback retests. Existing bullish/bearish trend must hold, price retests the Supertrend line, then closes back in trend direction.",
  configSchema,
  requiredBars: (c) => c.atrLength + 20,
  predict: (config, bars) => {
    const highs = bars.map((b) => b.high);
    const lows = bars.map((b) => b.low);
    const closes = bars.map((b) => b.close);
    const { trend, line } = computeSupertrendSeries({
      highs,
      lows,
      closes,
      atrLength: config.atrLength,
      multiplier: config.multiplier,
    });
    const n = bars.length;
    const latest = bars[n - 1];
    const currentTrend = trend[n - 1];
    const previousTrend = trend[n - 2];
    const currentLine = line[n - 1];
    const atr = computeAtrSeries({
      highs,
      lows,
      closes,
      period: config.atrLength,
    })[n - 2];
    const location = latest === undefined ? null : closeLocation(latest);
    if (
      latest === undefined ||
      currentTrend === null ||
      currentTrend === undefined ||
      previousTrend === null ||
      previousTrend === undefined ||
      currentTrend !== previousTrend ||
      currentLine === null ||
      currentLine === undefined ||
      atr === null ||
      atr === undefined ||
      atr <= 0 ||
      location === null
    ) {
      return null;
    }
    const maxDistance = config.maxDistanceAtr * atr;
    if (
      currentTrend === "up" &&
      latest.low <= currentLine + maxDistance &&
      latest.close > currentLine &&
      latest.close > latest.open &&
      location >= config.minCloseLocation
    ) {
      return "up";
    }
    if (
      currentTrend === "down" &&
      latest.high >= currentLine - maxDistance &&
      latest.close < currentLine &&
      latest.close < latest.open &&
      location <= 1 - config.minCloseLocation
    ) {
      return "down";
    }
    return null;
  },
};

registerFilter({
  filter: supertrendRetestFollow as Filter<unknown>,
  defaultConfigs: () => [
    {
      atrLength: 10,
      multiplier: 3,
      maxDistanceAtr: 0.25,
      minCloseLocation: 0.6,
    },
    {
      atrLength: 10,
      multiplier: 2.5,
      maxDistanceAtr: 0.2,
      minCloseLocation: 0.65,
    },
    {
      atrLength: 14,
      multiplier: 3,
      maxDistanceAtr: 0.3,
      minCloseLocation: 0.6,
    },
    { atrLength: 7, multiplier: 3, maxDistanceAtr: 0.2, minCloseLocation: 0.7 },
    {
      atrLength: 14,
      multiplier: 2.5,
      maxDistanceAtr: 0.15,
      minCloseLocation: 0.7,
    },
  ],
});
