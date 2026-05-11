import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeStochasticKSeries } from "@alea/lib/indicators/stochastic";
import { z } from "zod";

/**
 * Stochastic oscillator mean reversion. Predicts UP when %K is at
 * or below the `oversold` threshold (close sitting near the bottom
 * of the recent high-low range), DOWN at or above `overbought`
 * (close near the top), abstains otherwise.
 *
 * Structurally identical to `rsi_meanrev` — extreme oscillator
 * reading triggers a reversion bet — but the underlying indicator
 * normalizes against the **recent high-low range** instead of the
 * period's gain/loss distribution. RSI says "this is the gain
 * percentile of the last N close-to-close moves"; Stochastic says
 * "this is where the close sits in the last N bars' total range".
 *
 * Hypothesis: on bursty crypto bars where occasional wicks fail to
 * round-trip into closes, Stochastic and RSI disagree — and one of
 * the two normalizations is meaningfully better at flagging real
 * exhaustion. Side-by-side WR will say which.
 */
const configSchema = z.object({
  lookback: z.number().int().positive().default(14),
  smoothK: z.number().int().positive().default(3),
  oversold: z.number().min(0).max(100).default(20),
  overbought: z.number().min(0).max(100).default(80),
});
type Config = z.infer<typeof configSchema>;

export const stochasticMeanRev: Filter<Config> = {
  id: "stochastic_meanrev",
  version: 1,
  regime: "oscillator_reversion",
  description:
    "Mean reversion on the Stochastic %K oscillator. Fires UP when %K ≤ `oversold`, DOWN when ≥ `overbought`. %K is normalized against the trailing high-low range, not (like RSI) against the period's gain/loss distribution — head-to-head with `rsi_meanrev` tells us which normalization basis carries the reversion signal.",
  configSchema,
  // %K needs `lookback` bars + (smoothK - 1) more for smoothing.
  requiredBars: (c) => c.lookback + c.smoothK,
  predict: (config, bars) => {
    const highs = bars.map((b) => b.high);
    const lows = bars.map((b) => b.low);
    const closes = bars.map((b) => b.close);
    const k = computeStochasticKSeries({
      highs,
      lows,
      closes,
      lookback: config.lookback,
      smoothK: config.smoothK,
    });
    const latest = k[k.length - 1];
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
  filter: stochasticMeanRev as Filter<unknown>,
  defaultConfigs: () => [
    {"smoothK":1,"lookback":14,"oversold":10,"overbought":90},
    {"smoothK":1,"lookback":7,"oversold":10,"overbought":90},
    {"smoothK":3,"lookback":7,"oversold":10,"overbought":90},
    {"smoothK":3,"lookback":14,"oversold":10,"overbought":90},
    {"smoothK":3,"lookback":21,"oversold":10,"overbought":90},
  ],
});
