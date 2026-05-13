import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeWilderRsiSeries } from "@alea/lib/indicators/rsi";
import { z } from "zod";

/**
 * Mean-reversion read on RSI: predicts UP when the indicator looks
 * oversold, DOWN when it looks overbought, abstains otherwise.
 *
 * Hypothesis being tested: extreme RSI readings (especially at the
 * 30/70 thresholds traders talk about) tend to revert in the very
 * next bar more often than chance, even on 5-minute crypto.
 */
const configSchema = z.object({
  length: z.number().int().positive().default(14),
  oversold: z.number().min(0).max(100).default(30),
  overbought: z.number().min(0).max(100).default(70),
});
type Config = z.infer<typeof configSchema>;

export const rsiMeanRev: Filter<Config> = {
  id: "rsi_meanrev",
  version: 1,
  barSource: "pyth",
  family: "oscillator_reversion",
  description:
    "Classic two-sided RSI mean reversion. Engages UP when the latest RSI is at or below `oversold` (the indicator says 'price has fallen too far, expect a bounce'), DOWN when it's at or above `overbought` (the inverse), abstains when RSI sits in the neutral band between the two. RSI is computed with Wilder smoothing — the canonical formula TradingView and most charting tools use.",
  configSchema,
  requiredBars: (c) => c.length + 1,
  predict: (config, bars) => {
    const closes = bars.map((b) => b.close);
    const rsi = computeWilderRsiSeries({ closes, period: config.length });
    const latest = rsi[rsi.length - 1];
    if (latest === null || latest === undefined) {
      return null;
    }
    if (latest <= config.oversold) {
      return "up";
    }
    if (latest >= config.overbought) {
      return "down";
    }
    return null;
  },
};

registerFilter({
  filter: rsiMeanRev as Filter<unknown>,
  defaultConfigs: () => [
    { length: 7, oversold: 15, overbought: 85 },
    { length: 7, oversold: 20, overbought: 80 },
    { length: 21, oversold: 15, overbought: 85 },
    { length: 14, oversold: 20, overbought: 80 },
    { length: 14, oversold: 15, overbought: 85 },
  ],
});
