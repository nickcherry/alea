import {
  barRange,
  highestHigh,
  lowestLow,
} from "@alea/lib/filters/_barMath";
import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeAtrSeries } from "@alea/lib/indicators/atr";
import { z } from "zod";

const configSchema = z.object({
  lookback: z.number().int().positive().default(20),
  atrLength: z.number().int().positive().default(14),
  minSweepAtr: z.number().nonnegative().default(0.1),
  minRejectionFrac: z.number().min(0).max(1).default(0.35),
});
type Config = z.infer<typeof configSchema>;

export const liquiditySweepReversal: Filter<Config> = {
  id: "liquidity_sweep_reversal",
  version: 1,
  family: "structure_reversion",
  description:
    "Wick-style stop-run reversal. If the latest bar sweeps beyond the prior lookback high then closes back inside with enough rejection wick, predict DOWN; symmetric low sweep predicts UP.",
  configSchema,
  requiredBars: (c) => Math.max(c.lookback + 1, c.atrLength + 1),
  predict: (config, bars) => {
    const n = bars.length;
    const latest = bars[n - 1];
    if (latest === undefined) {
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
      period: config.atrLength,
    })[n - 2];
    const range = barRange(latest);
    if (atr === null || atr === undefined || atr <= 0 || range <= 0) {
      return null;
    }
    const minSweep = config.minSweepAtr * atr;
    const upperRejection = (latest.high - latest.close) / range;
    const lowerRejection = (latest.close - latest.low) / range;
    if (
      latest.high - priorHigh >= minSweep &&
      latest.close < priorHigh &&
      upperRejection >= config.minRejectionFrac
    ) {
      return "down";
    }
    if (
      priorLow - latest.low >= minSweep &&
      latest.close > priorLow &&
      lowerRejection >= config.minRejectionFrac
    ) {
      return "up";
    }
    return null;
  },
};

registerFilter({
  filter: liquiditySweepReversal as Filter<unknown>,
  defaultConfigs: () => [
    { lookback: 20, atrLength: 14, minSweepAtr: 0.1, minRejectionFrac: 0.35 },
    { lookback: 20, atrLength: 14, minSweepAtr: 0.2, minRejectionFrac: 0.45 },
    { lookback: 50, atrLength: 14, minSweepAtr: 0.1, minRejectionFrac: 0.35 },
    { lookback: 14, atrLength: 7, minSweepAtr: 0.1, minRejectionFrac: 0.4 },
    { lookback: 30, atrLength: 14, minSweepAtr: 0.3, minRejectionFrac: 0.5 },
  ],
});

