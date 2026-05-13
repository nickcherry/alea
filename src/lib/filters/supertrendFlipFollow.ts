import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeSupertrendSeries } from "@alea/lib/indicators/supertrend";
import { z } from "zod";

const configSchema = z.object({
  atrLength: z.number().int().positive().default(10),
  multiplier: z.number().positive().default(3),
});
type Config = z.infer<typeof configSchema>;

export const supertrendFlipFollow: Filter<Config> = {
  id: "supertrend_flip_follow",
  version: 1,
  barSource: "pyth",
  family: "trend_flip_continuation",
  description:
    "ATR trailing-stop trend flip. When Supertrend flips bullish on the latest closed candle, predict UP; when it flips bearish, predict DOWN.",
  configSchema,
  requiredBars: (c) => c.atrLength + 20,
  predict: (config, bars) => {
    const highs = bars.map((b) => b.high);
    const lows = bars.map((b) => b.low);
    const closes = bars.map((b) => b.close);
    const { trend } = computeSupertrendSeries({
      highs,
      lows,
      closes,
      atrLength: config.atrLength,
      multiplier: config.multiplier,
    });
    const latest = trend[trend.length - 1];
    const previous = trend[trend.length - 2];
    if (
      latest === null ||
      latest === undefined ||
      previous === null ||
      previous === undefined ||
      latest === previous
    ) {
      return null;
    }
    return latest;
  },
};

registerFilter({
  filter: supertrendFlipFollow as Filter<unknown>,
  defaultConfigs: () => [
    { atrLength: 10, multiplier: 3 },
    { atrLength: 10, multiplier: 2.5 },
    { atrLength: 7, multiplier: 3 },
    { atrLength: 14, multiplier: 2.5 },
    { atrLength: 14, multiplier: 3.5 },
  ],
});
