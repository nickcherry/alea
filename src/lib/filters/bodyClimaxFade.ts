import {
  bodyDirection,
  bodyFraction,
  bodySize,
} from "@alea/lib/filters/_barMath";
import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeAtrSeries } from "@alea/lib/indicators/atr";
import { z } from "zod";

const configSchema = z.object({
  bodyLookback: z.number().int().positive().default(20),
  bodyMultiplier: z.number().positive().default(3),
  atrLength: z.number().int().positive().default(14),
  minBodyAtr: z.number().nonnegative().default(0.8),
  minBodyFraction: z.number().min(0).max(1).default(0.65),
});
type Config = z.infer<typeof configSchema>;

export const bodyClimaxFade: Filter<Config> = {
  id: "body_climax_fade",
  version: 1,
  family: "candle_exhaustion",
  description:
    "Fades body-only climax candles. The latest open-to-close body must dwarf recent bodies and clear ATR/body-share gates; green climax predicts DOWN and red climax predicts UP.",
  configSchema,
  requiredBars: (c) => Math.max(c.bodyLookback + 1, c.atrLength + 2),
  predict: (config, bars) => {
    const n = bars.length;
    const latest = bars[n - 1];
    if (latest === undefined) {
      return null;
    }
    let bodySum = 0;
    for (let i = n - 1 - config.bodyLookback; i < n - 1; i += 1) {
      const bar = bars[i];
      if (bar === undefined) {
        return null;
      }
      bodySum += bodySize(bar);
    }
    const averageBody = bodySum / config.bodyLookback;
    const highs = bars.map((b) => b.high);
    const lows = bars.map((b) => b.low);
    const closes = bars.map((b) => b.close);
    const atr = computeAtrSeries({
      highs,
      lows,
      closes,
      period: config.atrLength,
    })[n - 2];
    const latestBody = bodySize(latest);
    const body = bodyFraction(latest);
    const direction = bodyDirection(latest);
    if (
      atr === null ||
      atr === undefined ||
      atr <= 0 ||
      averageBody <= 0 ||
      body === null ||
      body < config.minBodyFraction ||
      direction === null ||
      latestBody / atr < config.minBodyAtr ||
      latestBody < averageBody * config.bodyMultiplier
    ) {
      return null;
    }
    return direction === "up" ? "down" : "up";
  },
};

registerFilter({
  filter: bodyClimaxFade as Filter<unknown>,
  defaultConfigs: () => [
    {
      bodyLookback: 20,
      bodyMultiplier: 3,
      atrLength: 14,
      minBodyAtr: 0.8,
      minBodyFraction: 0.65,
    },
    {
      bodyLookback: 50,
      bodyMultiplier: 2.5,
      atrLength: 14,
      minBodyAtr: 0.8,
      minBodyFraction: 0.6,
    },
    {
      bodyLookback: 20,
      bodyMultiplier: 4,
      atrLength: 14,
      minBodyAtr: 1,
      minBodyFraction: 0.5,
    },
    {
      bodyLookback: 14,
      bodyMultiplier: 3,
      atrLength: 7,
      minBodyAtr: 0.7,
      minBodyFraction: 0.7,
    },
    {
      bodyLookback: 30,
      bodyMultiplier: 2.5,
      atrLength: 14,
      minBodyAtr: 1.2,
      minBodyFraction: 0.6,
    },
  ],
});
