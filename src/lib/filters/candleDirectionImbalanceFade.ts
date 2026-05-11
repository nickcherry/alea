import {
  bodyDirection,
  bodySize,
} from "@alea/lib/filters/_barMath";
import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeAtrSeries } from "@alea/lib/indicators/atr";
import { z } from "zod";

const ATR_LENGTH = 14;

const configSchema = z.object({
  lookback: z.number().int().positive().default(10),
  extremeRatio: z.number().min(0).max(1).default(0.8),
  minBodyAtr: z.number().nonnegative().default(0),
});
type Config = z.infer<typeof configSchema>;

export const candleDirectionImbalanceFade: Filter<Config> = {
  id: "candle_direction_imbalance_fade",
  version: 1,
  family: "directional_sequence_reversion",
  description:
    "Fades broad candle-direction imbalance. Too many recent up-body candles predict DOWN; too many down-body candles predict UP, without requiring a consecutive streak.",
  configSchema,
  requiredBars: (c) => Math.max(c.lookback, ATR_LENGTH + 1),
  predict: (config, bars) => {
    const highs = bars.map((b) => b.high);
    const lows = bars.map((b) => b.low);
    const closes = bars.map((b) => b.close);
    const atr = computeAtrSeries({
      highs,
      lows,
      closes,
      period: ATR_LENGTH,
    })[bars.length - 1];
    if (atr === null || atr === undefined || atr <= 0) {
      return null;
    }
    const minBody = config.minBodyAtr * atr;
    let up = 0;
    let down = 0;
    for (let i = bars.length - config.lookback; i < bars.length; i += 1) {
      const bar = bars[i];
      if (bar === undefined || bodySize(bar) < minBody) {
        continue;
      }
      const direction = bodyDirection(bar);
      if (direction === "up") {
        up += 1;
      } else if (direction === "down") {
        down += 1;
      }
    }
    if (up / config.lookback >= config.extremeRatio) {
      return "down";
    }
    if (down / config.lookback >= config.extremeRatio) {
      return "up";
    }
    return null;
  },
};

registerFilter({
  filter: candleDirectionImbalanceFade as Filter<unknown>,
  defaultConfigs: () => [
    { lookback: 6, extremeRatio: 0.833, minBodyAtr: 0 },
    { lookback: 8, extremeRatio: 0.875, minBodyAtr: 0 },
    { lookback: 10, extremeRatio: 0.8, minBodyAtr: 0.03 },
    { lookback: 12, extremeRatio: 0.75, minBodyAtr: 0.03 },
    { lookback: 20, extremeRatio: 0.7, minBodyAtr: 0.02 },
  ],
});

