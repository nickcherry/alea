import {
  bodyDirection,
  bodyFraction,
  bodySize,
  closeLocation,
} from "@alea/lib/filters/_barMath";
import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeAtrSeries } from "@alea/lib/indicators/atr";
import { z } from "zod";

const configSchema = z.object({
  atrLength: z.number().int().positive().default(14),
  minBodyAtr: z.number().nonnegative().default(0.6),
  minBodyFraction: z.number().min(0).max(1).default(0.65),
  minCloseLocation: z.number().min(0).max(1).default(0.8),
});
type Config = z.infer<typeof configSchema>;

export const strongBodyCloseFollow: Filter<Config> = {
  id: "strong_body_close_follow",
  version: 1,
  barSource: "pyth",
  family: "candle_momentum_continuation",
  description:
    "Follows decisive directional candles. A large body versus ATR, high body share, and close near the candle extreme predict same-direction continuation.",
  configSchema,
  requiredBars: (c) => c.atrLength + 2,
  predict: (config, bars) => {
    const n = bars.length;
    const latest = bars[n - 1];
    if (latest === undefined) {
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
    const direction = bodyDirection(latest);
    const body = bodyFraction(latest);
    const location = closeLocation(latest);
    if (
      atr === null ||
      atr === undefined ||
      atr <= 0 ||
      direction === null ||
      body === null ||
      body < config.minBodyFraction ||
      location === null ||
      bodySize(latest) / atr < config.minBodyAtr
    ) {
      return null;
    }
    if (direction === "up" && location >= config.minCloseLocation) {
      return "up";
    }
    if (direction === "down" && location <= 1 - config.minCloseLocation) {
      return "down";
    }
    return null;
  },
};

registerFilter({
  filter: strongBodyCloseFollow as Filter<unknown>,
  defaultConfigs: () => [
    {
      atrLength: 14,
      minBodyAtr: 0.6,
      minBodyFraction: 0.65,
      minCloseLocation: 0.8,
    },
    {
      atrLength: 14,
      minBodyAtr: 0.8,
      minBodyFraction: 0.7,
      minCloseLocation: 0.85,
    },
    {
      atrLength: 7,
      minBodyAtr: 0.6,
      minBodyFraction: 0.7,
      minCloseLocation: 0.85,
    },
    {
      atrLength: 20,
      minBodyAtr: 1,
      minBodyFraction: 0.6,
      minCloseLocation: 0.8,
    },
    {
      atrLength: 14,
      minBodyAtr: 0.4,
      minBodyFraction: 0.75,
      minCloseLocation: 0.9,
    },
  ],
});
