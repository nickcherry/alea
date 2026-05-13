import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { z } from "zod";

/**
 * Multi-bar percent-return reversion. Engages when the close has
 * moved more than `threshold` percent (as a fraction) over the
 * trailing `lookback` bars:
 *
 *   r = (close_i - close_{i - lookback}) / close_{i - lookback}
 *   if r ≥ +threshold   →  engage DOWN  (fade the sustained up move)
 *   if r ≤ -threshold   →  engage UP    (fade the sustained drop)
 *
 * Time-extended analog of `atr_burst_fade`. That one tests "single
 * bar moved a lot vs. normal volatility"; this one tests
 * "cumulative move across N bars exceeds a percent threshold".
 *
 * The hypothesis we're chasing: ATR-burst's edge comes from sudden
 * single-bar exhaustion. Does the SAME edge appear for
 * sustained-but-quieter drift? If yes, the reversion-mechanism is
 * about absolute distance covered, not pace. If no, only sudden
 * moves matter and sustained drift gets to keep going.
 *
 * Different from `zscore_reversion` (which is distance from rolling
 * MEAN, in std-dev units) because this is the raw cumulative
 * percent return — no mean anchor, no volatility normalization.
 */
const configSchema = z.object({
  /** Bars over which we measure the cumulative return. */
  lookback: z.number().int().positive().default(5),
  /** Absolute return required to engage, as a fraction (0.01 = 1%). */
  threshold: z.number().positive().default(0.01),
});
type Config = z.infer<typeof configSchema>;

export const multiBarReturnFade: Filter<Config> = {
  id: "multi_bar_return_fade",
  version: 1,
  barSource: "pyth",
  family: "velocity_fade",
  description:
    "Fades sustained percent moves. If the close has moved up by at least `threshold` over the last `lookback` bars, predict DOWN; symmetric for UP. No mean anchor or volatility normalization — pure cumulative return as the signal. Tests whether sustained drift mean-reverts the same way single-bar bursts do.",
  configSchema,
  requiredBars: (c) => c.lookback + 1,
  predict: (config, bars) => {
    const n = bars.length;
    if (n <= config.lookback) {
      return null;
    }
    const current = bars[n - 1]!.close;
    const earlier = bars[n - 1 - config.lookback]!.close;
    if (earlier <= 0) {
      return null;
    }
    const ret = (current - earlier) / earlier;
    if (ret >= config.threshold) {
      return "down";
    }
    if (ret <= -config.threshold) {
      return "up";
    }
    return null;
  },
};

registerFilter({
  filter: multiBarReturnFade as Filter<unknown>,
  defaultConfigs: () => [
    { lookback: 5, threshold: 0.03 },
    { lookback: 3, threshold: 0.02 },
    { lookback: 5, threshold: 0.02 },
    { lookback: 3, threshold: 0.01 },
    { lookback: 5, threshold: 0.01 },
  ],
});
