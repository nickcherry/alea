import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { z } from "zod";

/**
 * Streak fade. Predicts the OPPOSITE of the most recent run of
 * same-color bars, once that run hits `minStreak`:
 *
 *   N consecutive green bars (close ≥ open)   →   engage DOWN
 *   N consecutive red   bars (close <  open)   →   engage UP
 *
 * Bar color uses the same tie-break as the outcome rule
 * (close == open ⇒ "up"), so the streak signal lives in the same
 * direction-space as what we're predicting.
 *
 * The deleted `prior_bar_carry` filter tested the inverse hypothesis
 * — "N up bars in a row predicts ANOTHER up bar" — and got
 * progressively worse as N grew (48.8% / 48.4% / 47.2% on 5m for
 * N = 1 / 2 / 3). That's strong indirect evidence that the opposite
 * — fading the streak — gets correspondingly better. This filter
 * makes the test direct so we can read the per-N decay curve, plus
 * extend it to longer streaks (4, 5, 6, 7) that `prior_bar_carry`
 * didn't.
 *
 * No indicators, no levels, no math — just count and flip.
 */
const configSchema = z.object({
  /**
   * Minimum number of consecutive same-color bars (including the
   * latest one) required to engage. Below this, abstain.
   */
  minStreak: z.number().int().min(2).default(3),
});
type Config = z.infer<typeof configSchema>;

export const streakFade: Filter<Config> = {
  id: "streak_fade",
  version: 1,
  barSource: "pyth",
  family: "velocity_fade",
  description:
    "Engages opposite the most recent run of same-color bars once the streak length reaches `minStreak`. Direct inverse of the deleted `prior_bar_carry` filter — that one bet on continuation and lost monotonically with longer streaks; this bets on reversal and should win progressively more.",
  configSchema,
  requiredBars: (c) => c.minStreak,
  predict: (config, bars) => {
    const n = bars.length;
    if (n < config.minStreak) {
      return null;
    }
    const colorOf = (i: number): "up" | "down" => {
      const b = bars[i]!;
      return b.close >= b.open ? "up" : "down";
    };
    const latestColor = colorOf(n - 1);
    let streak = 1;
    for (let k = n - 2; k >= 0; k -= 1) {
      if (colorOf(k) !== latestColor) {
        break;
      }
      streak += 1;
      if (streak >= config.minStreak) {
        break;
      }
    }
    if (streak < config.minStreak) {
      return null;
    }
    return latestColor === "up" ? "down" : "up";
  },
};

registerFilter({
  filter: streakFade as Filter<unknown>,
  defaultConfigs: () => [
    { minStreak: 10 },
    { minStreak: 7 },
    { minStreak: 6 },
    { minStreak: 9 },
    { minStreak: 5 },
  ],
});
