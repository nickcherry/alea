import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeAtrSeries } from "@alea/lib/indicators/atr";
import { computeMacdSeries } from "@alea/lib/indicators/macd";
import { z } from "zod";

const configSchema = z.object({
  fast: z.number().int().positive().default(12),
  slow: z.number().int().positive().default(26),
  signal: z.number().int().positive().default(9),
  atrLength: z.number().int().positive().default(14),
  minHistAtr: z.number().nonnegative().default(0),
});
type Config = z.infer<typeof configSchema>;

export const macdSignalCrossFollow: Filter<Config> = {
  id: "macd_signal_cross_follow",
  version: 1,
  family: "momentum_cross_continuation",
  description:
    "Follows MACD signal-line crosses. A histogram cross above zero predicts UP; a cross below zero predicts DOWN, optionally requiring histogram size versus ATR.",
  configSchema,
  requiredBars: (c) => Math.max(c.slow + c.signal + 5, c.atrLength + 2),
  predict: (config, bars) => {
    if (config.fast >= config.slow) {
      return null;
    }
    const closes = bars.map((b) => b.close);
    const macd = computeMacdSeries({
      closes,
      fast: config.fast,
      slow: config.slow,
      signal: config.signal,
    });
    const n = bars.length;
    const current = macd[n - 1]?.histogram;
    const previous = macd[n - 2]?.histogram;
    const highs = bars.map((b) => b.high);
    const lows = bars.map((b) => b.low);
    const atr = computeAtrSeries({
      highs,
      lows,
      closes,
      period: config.atrLength,
    })[n - 2];
    if (
      current === null ||
      current === undefined ||
      previous === null ||
      previous === undefined ||
      atr === null ||
      atr === undefined ||
      atr <= 0 ||
      Math.abs(current) / atr < config.minHistAtr
    ) {
      return null;
    }
    if (previous <= 0 && current > 0) {
      return "up";
    }
    if (previous >= 0 && current < 0) {
      return "down";
    }
    return null;
  },
};

registerFilter({
  filter: macdSignalCrossFollow as Filter<unknown>,
  defaultConfigs: () => [
    { fast: 12, slow: 26, signal: 9, atrLength: 14, minHistAtr: 0 },
    { fast: 8, slow: 21, signal: 5, atrLength: 14, minHistAtr: 0 },
    { fast: 5, slow: 13, signal: 5, atrLength: 7, minHistAtr: 0 },
    { fast: 12, slow: 26, signal: 9, atrLength: 14, minHistAtr: 0.02 },
    { fast: 16, slow: 34, signal: 9, atrLength: 20, minHistAtr: 0 },
  ],
});
