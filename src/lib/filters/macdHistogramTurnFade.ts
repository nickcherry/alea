import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeMacdSeries } from "@alea/lib/indicators/macd";
import { z } from "zod";

const configSchema = z.object({
  fast: z.number().int().positive().default(12),
  slow: z.number().int().positive().default(26),
  signal: z.number().int().positive().default(9),
  zLength: z.number().int().positive().default(50),
  zThreshold: z.number().positive().default(2),
  turnBars: z.number().int().positive().default(1),
});
type Config = z.infer<typeof configSchema>;

export const macdHistogramTurnFade: Filter<Config> = {
  id: "macd_histogram_turn_fade",
  version: 1,
  barSource: "pyth",
  family: "momentum_exhaustion",
  description:
    "Fades extreme MACD histogram turns. A positive extreme rolling toward zero predicts DOWN; a negative extreme rolling toward zero predicts UP.",
  configSchema,
  requiredBars: (c) => c.slow + c.signal + c.zLength + c.turnBars + 5,
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
    const hist = macd.map((point) => point.histogram);
    const n = hist.length;
    const extremeIndex = n - 1 - config.turnBars;
    const extreme = hist[extremeIndex];
    if (extreme === null || extreme === undefined) {
      return null;
    }
    const baseline = hist
      .slice(extremeIndex - config.zLength, extremeIndex)
      .filter(
        (value): value is number => value !== null && value !== undefined,
      );
    const z = zScore({ values: baseline, value: extreme });
    if (z === null || Math.abs(z) < config.zThreshold) {
      return null;
    }
    for (let i = extremeIndex + 1; i < n; i += 1) {
      const current = hist[i];
      const previous = hist[i - 1];
      if (
        current === null ||
        current === undefined ||
        previous === null ||
        previous === undefined
      ) {
        return null;
      }
      if (extreme > 0 && current >= previous) {
        return null;
      }
      if (extreme < 0 && current <= previous) {
        return null;
      }
    }
    return extreme > 0 ? "down" : "up";
  },
};

registerFilter({
  filter: macdHistogramTurnFade as Filter<unknown>,
  defaultConfigs: () => [
    { fast: 12, slow: 26, signal: 9, zLength: 50, zThreshold: 2, turnBars: 1 },
    {
      fast: 12,
      slow: 26,
      signal: 9,
      zLength: 100,
      zThreshold: 2.5,
      turnBars: 1,
    },
    { fast: 8, slow: 21, signal: 5, zLength: 50, zThreshold: 2, turnBars: 1 },
    { fast: 5, slow: 13, signal: 5, zLength: 30, zThreshold: 2.5, turnBars: 1 },
    { fast: 16, slow: 34, signal: 9, zLength: 100, zThreshold: 2, turnBars: 2 },
    { fast: 5, slow: 13, signal: 5, zLength: 50, zThreshold: 2.5, turnBars: 1 },
    { fast: 8, slow: 21, signal: 5, zLength: 30, zThreshold: 2.5, turnBars: 1 },
    {
      fast: 8,
      slow: 21,
      signal: 5,
      zLength: 100,
      zThreshold: 2.5,
      turnBars: 1,
    },
    {
      fast: 12,
      slow: 26,
      signal: 9,
      zLength: 50,
      zThreshold: 2.5,
      turnBars: 1,
    },
    {
      fast: 12,
      slow: 26,
      signal: 9,
      zLength: 75,
      zThreshold: 2.25,
      turnBars: 1,
    },
  ],
});

function zScore({
  values,
  value,
}: {
  readonly values: readonly number[];
  readonly value: number;
}): number | null {
  if (values.length < 2) {
    return null;
  }
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  let ss = 0;
  for (const v of values) {
    ss += (v - mean) ** 2;
  }
  const stdev = Math.sqrt(ss / (values.length - 1));
  if (stdev <= 0) {
    return null;
  }
  return (value - mean) / stdev;
}
