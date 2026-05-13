import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeCciSeries } from "@alea/lib/indicators/cci";
import { z } from "zod";

/**
 * CCI mean reversion. Predicts UP when CCI is at or below
 * `oversold`, DOWN at or above `overbought`. Structurally identical
 * to `rsi_meanrev` / `stochastic_meanrev` but on a third oscillator
 * family: CCI normalizes against mean absolute deviation of the
 * typical price (HLC/3), where RSI normalizes against the gain/loss
 * distribution and Stochastic normalizes against the high-low range.
 *
 * Hypothesis: three oscillator flavors hitting the same "extreme"
 * read should give similar WR. If CCI lands noticeably above or
 * below the RSI / Stochastic baseline, the MAD-based normalization
 * is doing something the other two miss.
 *
 * Classic thresholds are ±100 — Lambert's original scaling targeted
 * those as the rough 70-80th percentile bands. We seed those plus
 * tighter (±150, ±200) variants to test the deeper-stretch story.
 */
const configSchema = z.object({
  length: z.number().int().positive().default(20),
  /** Engage DOWN when CCI ≥ this. */
  overbought: z.number().default(100),
  /** Engage UP when CCI ≤ this. */
  oversold: z.number().default(-100),
});
type Config = z.infer<typeof configSchema>;

export const cciMeanRev: Filter<Config> = {
  id: "cci_meanrev",
  version: 1,
  barSource: "pyth",
  family: "oscillator_reversion",
  description:
    "Mean reversion on the Commodity Channel Index. Engages UP when CCI ≤ `oversold`, DOWN when ≥ `overbought`. Third oscillator family in the registry — alongside RSI (gain/loss percentile) and Stochastic (recent-range percentile), CCI uses mean absolute deviation of the typical price. Side-by-side WR tells us whether the MAD-based normalization sees the same reversion signal as the other two.",
  configSchema,
  requiredBars: (c) => c.length + 1,
  predict: (config, bars) => {
    const cci = computeCciSeries({
      highs: bars.map((b) => b.high),
      lows: bars.map((b) => b.low),
      closes: bars.map((b) => b.close),
      period: config.length,
    });
    const latest = cci[cci.length - 1];
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
  filter: cciMeanRev as Filter<unknown>,
  defaultConfigs: () => [
    { length: 20, oversold: -250, overbought: 250 },
    { length: 14, oversold: -200, overbought: 200 },
    { length: 20, oversold: -200, overbought: 200 },
    { length: 30, oversold: -200, overbought: 200 },
    { length: 14, oversold: -150, overbought: 150 },
    { length: 20, oversold: -300, overbought: 300 },
    { length: 30, oversold: -250, overbought: 250 },
    { length: 14, oversold: -300, overbought: 300 },
    { length: 50, oversold: -200, overbought: 200 },
    { length: 30, oversold: -300, overbought: 300 },
    { length: 50, oversold: -250, overbought: 250 },
  ],
});
