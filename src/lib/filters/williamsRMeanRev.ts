import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { z } from "zod";

/**
 * Williams %R mean reversion.
 *
 *   %R = -100 × (highest_high_N - close) / (highest_high_N - lowest_low_N)
 *
 * Ranges -100..0 (inverted Stochastic). UP at oversold (≤ -80),
 * DOWN at overbought (≥ -20). Sibling of `stochastic_meanrev` —
 * tests the inverted normalization for any meaningful difference.
 */
const configSchema = z.object({
  lookback: z.number().int().positive().default(14),
  oversold: z.number().default(-80),
  overbought: z.number().default(-20),
});
type Config = z.infer<typeof configSchema>;

export const williamsRMeanRev: Filter<Config> = {
  id: "williams_r_meanrev",
  version: 1,
  family: "oscillator_reversion",
  description:
    "Williams %R mean reversion. Engages UP at oversold readings (≤ `oversold`, default -80), DOWN at overbought (≥ `overbought`, default -20). Inverted-Stochastic family.",
  configSchema,
  requiredBars: (c) => c.lookback + 1,
  predict: (config, bars) => {
    const i = bars.length - 1;
    const close = bars[i]?.close;
    if (close === undefined) {
      return null;
    }
    let hi = -Infinity;
    let lo = Infinity;
    for (let k = i - config.lookback + 1; k <= i; k += 1) {
      const b = bars[k];
      if (b === undefined) {
        return null;
      }
      if (b.high > hi) {
        hi = b.high;
      }
      if (b.low < lo) {
        lo = b.low;
      }
    }
    const range = hi - lo;
    if (!Number.isFinite(range) || range <= 0) {
      return null;
    }
    const wr = (-100 * (hi - close)) / range;
    if (wr <= config.oversold) {
      return "up";
    }
    if (wr >= config.overbought) {
      return "down";
    }
    return null;
  },
};

registerFilter({
  filter: williamsRMeanRev as Filter<unknown>,
  defaultConfigs: () => [
    { lookback: 14, oversold: -90, overbought: -10 },
    { lookback: 21, oversold: -90, overbought: -10 },
    { lookback: 14, oversold: -85, overbought: -15 },
    { lookback: 14, oversold: -80, overbought: -20 },
    { lookback: 21, oversold: -80, overbought: -20 },
  ],
});
