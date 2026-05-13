import {
  barRange,
  bodyDirection,
  bodyFraction,
  meanVolume,
} from "@alea/lib/filters/_barMath";
import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeAtrSeries } from "@alea/lib/indicators/atr";
import { z } from "zod";

const configSchema = z.object({
  volLength: z.number().int().positive().default(20),
  volMultiplier: z.number().positive().default(2.5),
  atrLength: z.number().int().positive().default(14),
  minRangeAtr: z.number().nonnegative().default(1.5),
  minBodyFraction: z.number().min(0).max(1).default(0.5),
});
type Config = z.infer<typeof configSchema>;

export const volumeClimaxFade: Filter<Config> = {
  id: "volume_climax_fade",
  version: 1,
  barSource: "coinbase",
  family: "volume_exhaustion",
  description:
    "Fades high-volume range/body climaxes. A large bullish body on high relative volume predicts DOWN; a large bearish body predicts UP.",
  configSchema,
  requiredBars: (c) => Math.max(c.volLength + 1, c.atrLength + 2),
  predict: (config, bars) => {
    const n = bars.length;
    const latest = bars[n - 1];
    if (latest === undefined) {
      return null;
    }
    const avgVolume = meanVolume({
      bars,
      start: n - 1 - config.volLength,
      endExclusive: n - 1,
    });
    if (avgVolume === null || avgVolume <= 0) {
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
    const body = bodyFraction(latest);
    const direction = bodyDirection(latest);
    if (
      atr === null ||
      atr === undefined ||
      atr <= 0 ||
      body === null ||
      body < config.minBodyFraction ||
      direction === null
    ) {
      return null;
    }
    if (
      latest.volume / avgVolume < config.volMultiplier ||
      barRange(latest) < config.minRangeAtr * atr
    ) {
      return null;
    }
    return direction === "up" ? "down" : "up";
  },
};

registerFilter({
  filter: volumeClimaxFade as Filter<unknown>,
  defaultConfigs: () => [
    { volLength: 20, volMultiplier: 2.5, atrLength: 14, minRangeAtr: 1.5, minBodyFraction: 0.5 },
    { volLength: 20, volMultiplier: 3, atrLength: 14, minRangeAtr: 1.2, minBodyFraction: 0.5 },
    { volLength: 50, volMultiplier: 2.5, atrLength: 14, minRangeAtr: 1.5, minBodyFraction: 0.6 },
    { volLength: 20, volMultiplier: 4, atrLength: 14, minRangeAtr: 1, minBodyFraction: 0.4 },
    { volLength: 50, volMultiplier: 3, atrLength: 20, minRangeAtr: 1.3, minBodyFraction: 0.5 },
  ],
});

