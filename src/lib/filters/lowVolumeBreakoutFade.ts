import {
  highestHigh,
  lowestLow,
  meanVolume,
} from "@alea/lib/filters/_barMath";
import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeAtrSeries } from "@alea/lib/indicators/atr";
import { z } from "zod";

const ATR_LENGTH = 14;

const configSchema = z.object({
  lookback: z.number().int().positive().default(20),
  volLength: z.number().int().positive().default(20),
  maxRelVol: z.number().positive().default(0.7),
  minBreakAtr: z.number().nonnegative().default(0),
});
type Config = z.infer<typeof configSchema>;

export const lowVolumeBreakoutFade: Filter<Config> = {
  id: "low_volume_breakout_fade",
  version: 1,
  family: "participation_failure",
  description:
    "Fades breakouts that lack volume participation. A close above a recent high on below-average volume predicts DOWN; a weak-volume close below a recent low predicts UP.",
  configSchema,
  requiredBars: (c) => Math.max(c.lookback + 1, c.volLength + 1, ATR_LENGTH + 2),
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
    if (latest.volume / avgVolume > config.maxRelVol) {
      return null;
    }
    const priorHigh = highestHigh({
      bars,
      start: n - 1 - config.lookback,
      endExclusive: n - 1,
    });
    const priorLow = lowestLow({
      bars,
      start: n - 1 - config.lookback,
      endExclusive: n - 1,
    });
    if (priorHigh === null || priorLow === null) {
      return null;
    }
    const highs = bars.map((b) => b.high);
    const lows = bars.map((b) => b.low);
    const closes = bars.map((b) => b.close);
    const atr = computeAtrSeries({
      highs,
      lows,
      closes,
      period: ATR_LENGTH,
    })[n - 2];
    if (atr === null || atr === undefined || atr <= 0) {
      return null;
    }
    const minBreak = config.minBreakAtr * atr;
    if (latest.close - priorHigh >= minBreak) {
      return "down";
    }
    if (priorLow - latest.close >= minBreak) {
      return "up";
    }
    return null;
  },
};

registerFilter({
  filter: lowVolumeBreakoutFade as Filter<unknown>,
  defaultConfigs: () => [
    { lookback: 20, volLength: 20, maxRelVol: 0.7, minBreakAtr: 0 },
    { lookback: 14, volLength: 20, maxRelVol: 0.75, minBreakAtr: 0 },
    { lookback: 30, volLength: 50, maxRelVol: 0.65, minBreakAtr: 0.05 },
    { lookback: 50, volLength: 50, maxRelVol: 0.6, minBreakAtr: 0.1 },
    { lookback: 20, volLength: 50, maxRelVol: 0.8, minBreakAtr: 0.05 },
  ],
});

