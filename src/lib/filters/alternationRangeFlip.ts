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
  lookback: z.number().int().positive().default(5),
  minFlipRatio: z.number().min(0).max(1).default(1),
  minBodyAtr: z.number().nonnegative().default(0),
});
type Config = z.infer<typeof configSchema>;

export const alternationRangeFlip: Filter<Config> = {
  id: "alternation_range_flip",
  version: 1,
  barSource: "pyth",
  family: "directional_sequence_pattern",
  description:
    "Alternating-body range pattern. When recent candle signs flip often enough, predict the opposite of the latest candle body.",
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
    const directions: ("up" | "down" | null)[] = [];
    for (let i = bars.length - config.lookback; i < bars.length; i += 1) {
      const bar = bars[i];
      if (bar === undefined || bodySize(bar) < minBody) {
        directions.push(null);
        continue;
      }
      directions.push(bodyDirection(bar));
    }
    const latest = directions[directions.length - 1];
    if (latest === null || latest === undefined) {
      return null;
    }
    let flips = 0;
    for (let i = 1; i < directions.length; i += 1) {
      const previous = directions[i - 1];
      const current = directions[i];
      if (
        previous !== null &&
        previous !== undefined &&
        current !== null &&
        current !== undefined &&
        previous !== current
      ) {
        flips += 1;
      }
    }
    const flipRatio = flips / Math.max(config.lookback - 1, 1);
    if (flipRatio < config.minFlipRatio) {
      return null;
    }
    return latest === "up" ? "down" : "up";
  },
};

registerFilter({
  filter: alternationRangeFlip as Filter<unknown>,
  defaultConfigs: () => [
    { lookback: 5, minFlipRatio: 1, minBodyAtr: 0 },
    { lookback: 6, minFlipRatio: 0.8, minBodyAtr: 0.02 },
    { lookback: 8, minFlipRatio: 0.75, minBodyAtr: 0.02 },
    { lookback: 10, minFlipRatio: 0.7, minBodyAtr: 0.01 },
    { lookback: 12, minFlipRatio: 0.7, minBodyAtr: 0.02 },
  ],
});

