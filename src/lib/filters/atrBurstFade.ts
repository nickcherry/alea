import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeAtrSeries } from "@alea/lib/indicators/atr";
import { z } from "zod";

/**
 * ATR burst fade. Predicts the OPPOSITE direction when the latest
 * bar's close-to-close move exceeds `multiplier × ATR`:
 *
 *   move = close_i - close_{i-1}
 *   if  move > +multiplier · ATR_{i-1}   → engage DOWN
 *   if  move < -multiplier · ATR_{i-1}   → engage UP
 *
 * Pure "big move = exhaustion" hypothesis without any level anchor.
 * Distinct from every reversion filter we've shipped so far:
 *
 *   - `bollinger_reversion` / `zscore_reversion` / `bollinger_percent_b`
 *     all anchor on a rolling mean and check distance from it.
 *   - `keltner_reversion` does too, just with ATR-spaced bands.
 *   - `rsi_meanrev` / `stochastic_meanrev` / `cci_meanrev` anchor on
 *     an oscillator's extreme reading.
 *
 * This filter doesn't ask "where is price relative to baseline X?"
 * — it asks "did the last bar move more than usual?". The size of
 * the move IS the signal. Side-by-side with the level-anchored
 * reversion family will tell us whether the edge comes from
 * mispricing-vs-baseline or just from velocity-burst exhaustion.
 *
 * Uses `ATR_{i-1}` (the volatility regime BEFORE bar i, not
 * including bar i's own TR) so the threshold isn't self-inflated by
 * the burst we're measuring.
 */
const configSchema = z.object({
  length: z.number().int().positive().default(14),
  multiplier: z.number().positive().default(2),
});
type Config = z.infer<typeof configSchema>;

export const atrBurstFade: Filter<Config> = {
  id: "atr_burst_fade",
  version: 1,
  barSource: "pyth",
  family: "velocity_fade",
  description:
    "Fades single-bar close-to-close bursts. If the latest move is more than `multiplier × ATR` of the prior bar's ATR, predict the opposite direction. No baseline / level anchor — only the size of the move matters. Cleanest test of the 'big move = exhaustion' hypothesis without conflating with mean-reversion-to-MA.",
  configSchema,
  requiredBars: (c) => c.length + 2,
  predict: (config, bars) => {
    const n = bars.length;
    if (n < 2) {
      return null;
    }
    const closes = bars.map((b) => b.close);
    const highs = bars.map((b) => b.high);
    const lows = bars.map((b) => b.low);
    const atr = computeAtrSeries({
      highs,
      lows,
      closes,
      period: config.length,
    });
    // Read ATR through bar i-1, NOT bar i — we don't want to
    // normalize the burst by an ATR that already includes the
    // burst's own true-range.
    const baseline = atr[n - 2];
    if (baseline === null || baseline === undefined || baseline <= 0) {
      return null;
    }
    const move = closes[n - 1]! - closes[n - 2]!;
    const threshold = config.multiplier * baseline;
    if (move >= threshold) {
      return "down";
    }
    if (move <= -threshold) {
      return "up";
    }
    return null;
  },
};

registerFilter({
  filter: atrBurstFade as Filter<unknown>,
  defaultConfigs: () => [
    { length: 14, multiplier: 3 },
    { length: 50, multiplier: 2.5 },
    { length: 7, multiplier: 3 },
    { length: 50, multiplier: 2 },
    { length: 14, multiplier: 2.5 },
  ],
});
