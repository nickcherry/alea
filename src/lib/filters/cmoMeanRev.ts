import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { z } from "zod";

/**
 * Chande Momentum Oscillator mean reversion.
 *
 *   sumGain = Σ max(close_i - close_{i-1}, 0) over N bars
 *   sumLoss = Σ max(close_{i-1} - close_i, 0) over N bars
 *   CMO    = 100 × (sumGain - sumLoss) / (sumGain + sumLoss)
 *
 * Ranges -100..100. Like RSI but uses raw sums rather than averages
 * with Wilder smoothing — reacts faster to recent action. Fires UP
 * at deep negatives (oversold), DOWN at deep positives.
 */
const configSchema = z.object({
  period: z.number().int().positive().default(14),
  oversold: z.number().default(-50),
  overbought: z.number().default(50),
});
type Config = z.infer<typeof configSchema>;

export const cmoMeanRev: Filter<Config> = {
  id: "cmo_meanrev",
  version: 1,
  family: "oscillator_reversion",
  description:
    "Chande Momentum Oscillator reversion. Faster-reacting cousin of RSI — uses raw gain/loss sums instead of Wilder-smoothed averages.",
  configSchema,
  requiredBars: (c) => c.period + 2,
  predict: (config, bars) => {
    const n = bars.length;
    if (n < config.period + 1) {
      return null;
    }
    let sumGain = 0;
    let sumLoss = 0;
    for (let k = n - config.period; k <= n - 1; k += 1) {
      const cur = bars[k]?.close;
      const prev = bars[k - 1]?.close;
      if (cur === undefined || prev === undefined) {
        return null;
      }
      const diff = cur - prev;
      if (diff > 0) {
        sumGain += diff;
      } else if (diff < 0) {
        sumLoss -= diff;
      }
    }
    const denom = sumGain + sumLoss;
    if (denom <= 0) {
      return null;
    }
    const cmo = (100 * (sumGain - sumLoss)) / denom;
    if (cmo <= config.oversold) {
      return "up";
    }
    if (cmo >= config.overbought) {
      return "down";
    }
    return null;
  },
};

registerFilter({
  filter: cmoMeanRev as Filter<unknown>,
  defaultConfigs: () => [
    { period: 21, oversold: -70, overbought: 70 },
    { period: 14, oversold: -60, overbought: 60 },
    { period: 14, oversold: -70, overbought: 70 },
    { period: 14, oversold: -50, overbought: 50 },
    { period: 9, oversold: -50, overbought: 50 },
  ],
});
