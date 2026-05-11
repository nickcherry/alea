import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeWilderRsiSeries } from "@alea/lib/indicators/rsi";
import { z } from "zod";

/**
 * Stochastic RSI — compound oscillator. Applies Stochastic-style
 * normalization to the RSI series:
 *
 *   srsi_i = (RSI_i - min(RSI_{i-N+1..i})) / (max(RSI_{i-N+1..i}) - min(...))
 *
 * Multiplied by 100 to land on a 0..100 scale. Then optionally
 * SMA-smoothed by `smoothK` bars to match the canonical Slow
 * Stoch RSI variant.
 *
 * Different from running RSI and Stochastic *independently* in
 * confluence: this is a single, compound oscillator. RSI smooths
 * gain/loss into an oscillator; Stoch then normalizes THAT
 * oscillator against its own recent range. The output reads as
 * "how extreme is the current RSI value relative to its trailing
 * range" — which can disagree with the RSI level itself.
 *
 * Fires UP at low %SRSI (current RSI is at the low end of its
 * recent range), DOWN at high %SRSI.
 */
const configSchema = z.object({
  rsiLength: z.number().int().positive().default(14),
  stochLookback: z.number().int().positive().default(14),
  smoothK: z.number().int().positive().default(3),
  oversold: z.number().min(0).max(100).default(20),
  overbought: z.number().min(0).max(100).default(80),
});
type Config = z.infer<typeof configSchema>;

export const stochRsiMeanRev: Filter<Config> = {
  id: "stoch_rsi_meanrev",
  version: 1,
  family: "oscillator_reversion",
  description:
    "Stochastic RSI mean reversion. Stochastic-normalize the RSI series, then fire on the resulting compound oscillator's extremes. Tests whether COMPOSING two oscillators (Stoch of RSI) captures signal that running them in confluence (AND) misses.",
  configSchema,
  requiredBars: (c) => c.rsiLength + c.stochLookback + c.smoothK,
  predict: (config, bars) => {
    const closes = bars.map((b) => b.close);
    const rsi = computeWilderRsiSeries({
      closes,
      period: config.rsiLength,
    });
    const n = rsi.length;
    if (n < config.stochLookback) {
      return null;
    }
    // Compute %SRSI series at indices where the lookback window
    // is fully populated.
    const srsi = new Array<number | null>(n).fill(null);
    for (let i = config.stochLookback - 1; i < n; i += 1) {
      let hi = -Infinity;
      let lo = Infinity;
      let ok = true;
      for (let j = i - config.stochLookback + 1; j <= i; j += 1) {
        const v = rsi[j];
        if (v === null || v === undefined) {
          ok = false;
          break;
        }
        if (v > hi) {
          hi = v;
        }
        if (v < lo) {
          lo = v;
        }
      }
      if (!ok) {
        continue;
      }
      const span = hi - lo;
      const current = rsi[i];
      if (span <= 0 || current === null || current === undefined) {
        continue;
      }
      srsi[i] = ((current - lo) / span) * 100;
    }
    // Smooth via simple moving average if smoothK > 1.
    let latest: number | null;
    if (config.smoothK <= 1) {
      const v = srsi[n - 1];
      latest = v === undefined ? null : v;
    } else {
      const end = n - 1;
      const start = end - config.smoothK + 1;
      if (start < 0) {
        return null;
      }
      let sum = 0;
      for (let i = start; i <= end; i += 1) {
        const v = srsi[i];
        if (v === null || v === undefined) {
          return null;
        }
        sum += v;
      }
      latest = sum / config.smoothK;
    }
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
  filter: stochRsiMeanRev as Filter<unknown>,
  defaultConfigs: () => [
    {
      smoothK: 1,
      oversold: 10,
      rsiLength: 14,
      overbought: 90,
      stochLookback: 14,
    },
    {
      smoothK: 3,
      oversold: 10,
      rsiLength: 14,
      overbought: 90,
      stochLookback: 14,
    },
    {
      smoothK: 1,
      oversold: 20,
      rsiLength: 14,
      overbought: 80,
      stochLookback: 14,
    },
    {
      smoothK: 3,
      oversold: 15,
      rsiLength: 14,
      overbought: 85,
      stochLookback: 14,
    },
    {
      smoothK: 3,
      oversold: 20,
      rsiLength: 7,
      overbought: 80,
      stochLookback: 14,
    },
  ],
});
