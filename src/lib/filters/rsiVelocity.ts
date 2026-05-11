import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeWilderRsiSeries } from "@alea/lib/indicators/rsi";
import { z } from "zod";

/**
 * RSI velocity reversion. Fires on the *rate of change* of RSI
 * rather than its current level:
 *
 *   delta = RSI_i - RSI_{i - lookback}
 *   if delta ≤ -threshold   →  fire UP   (RSI dropped sharply)
 *   if delta ≥ +threshold   →  fire DOWN (RSI surged sharply)
 *
 * Distinct from `rsi_meanrev`, which fires on the indicator's
 * absolute level (RSI ≤ 30 → UP). The level view says "we're at
 * an extreme". The velocity view says "we just got there fast".
 * These can disagree: RSI can sit at 25 for several bars (level
 * extreme, low velocity) or drop from 60 → 40 in three bars (no
 * level extreme, high velocity).
 *
 * Hypothesis: the second-derivative read is a different look at
 * exhaustion. Markets that drop fast tend to bounce; markets that
 * grind to a low don't necessarily bounce. If this WR beats the
 * level-based RSI mean-reversion, the velocity dimension is the
 * better lens.
 */
const configSchema = z.object({
  /** RSI period passed straight to `computeWilderRsiSeries`. */
  rsiLength: z.number().int().positive().default(14),
  /** Bars between the two RSI samples we diff. */
  lookback: z.number().int().positive().default(3),
  /** Absolute RSI delta required to fire. */
  threshold: z.number().positive().default(20),
});
type Config = z.infer<typeof configSchema>;

export const rsiVelocity: Filter<Config> = {
  id: "rsi_velocity",
  version: 1,
  family: "velocity_fade",
  description:
    "Fires on the RATE of change of RSI rather than its level. A drop ≥ `threshold` RSI points across `lookback` bars → UP; symmetric for DOWN. Alternative to `rsi_meanrev` that tests whether 'we got to an extreme fast' is a stronger signal than 'we are at an extreme'.",
  configSchema,
  requiredBars: (c) => c.rsiLength + c.lookback + 1,
  predict: (config, bars) => {
    const closes = bars.map((b) => b.close);
    const rsi = computeWilderRsiSeries({
      closes,
      period: config.rsiLength,
    });
    const i = rsi.length - 1;
    const current = rsi[i];
    const earlier = rsi[i - config.lookback];
    if (
      current === null ||
      current === undefined ||
      earlier === null ||
      earlier === undefined
    ) {
      return null;
    }
    const delta = current - earlier;
    if (delta <= -config.threshold) {
      return "up";
    }
    if (delta >= config.threshold) {
      return "down";
    }
    return null;
  },
};

registerFilter({
  filter: rsiVelocity as Filter<unknown>,
  defaultConfigs: () => [
    { lookback: 3, rsiLength: 14, threshold: 25 },
    { lookback: 3, rsiLength: 14, threshold: 30 },
    { lookback: 2, rsiLength: 14, threshold: 25 },
    { lookback: 2, rsiLength: 14, threshold: 20 },
    { lookback: 3, rsiLength: 14, threshold: 20 },
  ],
});
