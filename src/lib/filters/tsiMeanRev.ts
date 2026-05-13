import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeEmaSeries } from "@alea/lib/indicators/ema";
import { z } from "zod";

/**
 * True Strength Index mean reversion. Double-smoothed momentum:
 *
 *   delta_i      = close_i - close_{i-1}
 *   pcDouble     = EMA(EMA(delta, long), short)
 *   absPcDouble  = EMA(EMA(|delta|, long), short)
 *   TSI          = 100 × pcDouble / absPcDouble
 *
 * Ranges roughly -100..100. Double-smoothing produces a much
 * cleaner oscillator than RSI / CMO at the cost of more lag. Tests
 * whether smoothness gives a real edge on the reversion thesis or
 * just hides actionable extremes.
 */
const configSchema = z.object({
  longLen: z.number().int().positive().default(25),
  shortLen: z.number().int().positive().default(13),
  overbought: z.number().default(25),
  oversold: z.number().default(-25),
});
type Config = z.infer<typeof configSchema>;

export const tsiMeanRev: Filter<Config> = {
  id: "tsi_meanrev",
  version: 1,
  barSource: "pyth",
  family: "oscillator_reversion",
  description:
    "Mean reversion on the True Strength Index — double-smoothed momentum oscillator. Smoother than RSI / CMO at the cost of more lag; engages on canonical ±25 extremes by default.",
  configSchema,
  requiredBars: (c) => c.longLen + c.shortLen + 2,
  predict: (config, bars) => {
    const n = bars.length;
    if (n < 2) {
      return null;
    }
    const deltas: number[] = [];
    const absDeltas: number[] = [];
    for (let k = 1; k < n; k += 1) {
      const a = bars[k - 1]?.close;
      const b = bars[k]?.close;
      if (a === undefined || b === undefined) {
        return null;
      }
      const d = b - a;
      deltas.push(d);
      absDeltas.push(Math.abs(d));
    }
    const ema1 = computeEmaSeries({ closes: deltas, period: config.longLen });
    const ema2 = computeEmaSeries({
      closes: absDeltas,
      period: config.longLen,
    });
    // EMA-of-EMA — feed first EMA output through again. Replace
    // null seed entries with the underlying delta so the second
    // EMA can converge.
    const ema1f = ema1.map((v, i) => (v === null ? (deltas[i] ?? 0) : v));
    const ema2f = ema2.map((v, i) => (v === null ? (absDeltas[i] ?? 0) : v));
    const pc = computeEmaSeries({ closes: ema1f, period: config.shortLen });
    const apc = computeEmaSeries({ closes: ema2f, period: config.shortLen });
    const idx = pc.length - 1;
    const num = pc[idx];
    const den = apc[idx];
    if (
      num === null ||
      num === undefined ||
      den === null ||
      den === undefined
    ) {
      return null;
    }
    if (den <= 0) {
      return null;
    }
    const tsi = (100 * num) / den;
    if (tsi <= config.oversold) {
      return "up";
    }
    if (tsi >= config.overbought) {
      return "down";
    }
    return null;
  },
};

registerFilter({
  filter: tsiMeanRev as Filter<unknown>,
  defaultConfigs: () => [
    { longLen: 13, oversold: -40, shortLen: 7, overbought: 40 },
    { longLen: 13, oversold: -25, shortLen: 7, overbought: 25 },
    { longLen: 25, oversold: -40, shortLen: 13, overbought: 40 },
    { longLen: 25, oversold: -25, shortLen: 13, overbought: 25 },
    { longLen: 40, oversold: -25, shortLen: 13, overbought: 25 },
    { longLen: 13, oversold: -50, shortLen: 7, overbought: 50 },
    { longLen: 9, oversold: -40, shortLen: 5, overbought: 40 },
    { longLen: 13, oversold: -60, shortLen: 7, overbought: 60 },
    { longLen: 9, oversold: -50, shortLen: 5, overbought: 50 },
  ],
});
