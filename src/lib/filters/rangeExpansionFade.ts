import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { z } from "zod";

/**
 * Range expansion fade. When the latest bar's (high - low) range is
 * more than `multiplier ×` the average range of the prior `window`
 * bars, predict the OPPOSITE of the bar's color:
 *
 *   range_i = high_i - low_i
 *   avg     = mean(range_{i-window..i-1})
 *   if  range_i > multiplier · avg:
 *     close_i ≥ open_i  →  engage DOWN   (green burst → expect red next)
 *     close_i <  open_i  →  engage UP
 *
 * Sibling of `atr_burst_fade` but anchored on the bar's RANGE
 * (high - low) rather than its close-to-close MOVE:
 *
 *   - `atr_burst_fade` says "the close moved a lot compared to
 *     normal volatility, fade the move".
 *   - `range_expansion_fade` says "the bar spanned a lot of price,
 *     fade the bar's overall color".
 *
 * Two bars can have similar ranges but very different close-vs-open
 * directions (a 2σ wide bar that closes near the middle vs. one
 * that closes at the high). The hypothesis being tested here is
 * that range-burst alone, regardless of where in the range we
 * closed, is enough signal to fade.
 *
 * Uses the prior `window` bars' average (NOT including the current
 * bar) so the baseline isn't inflated by the burst we're scoring.
 */
const configSchema = z.object({
  window: z.number().int().positive().default(20),
  multiplier: z.number().positive().default(2),
});
type Config = z.infer<typeof configSchema>;

export const rangeExpansionFade: Filter<Config> = {
  id: "range_expansion_fade",
  version: 1,
  barSource: "pyth",
  family: "velocity_fade",
  description:
    "Fades bars whose high-low range is more than `multiplier ×` the average range of the prior `window` bars. Predicts opposite of the bar's color (green burst → DOWN, red burst → UP). Range-based companion to `atr_burst_fade`: that one keys off close-to-close move; this one keys off the bar's total span.",
  configSchema,
  requiredBars: (c) => c.window + 1,
  predict: (config, bars) => {
    const n = bars.length;
    if (n < config.window + 1) {
      return null;
    }
    const latest = bars[n - 1]!;
    const currentRange = latest.high - latest.low;
    if (currentRange <= 0) {
      return null;
    }
    let sum = 0;
    for (let k = n - 1 - config.window; k <= n - 2; k += 1) {
      const b = bars[k]!;
      sum += b.high - b.low;
    }
    const avg = sum / config.window;
    if (avg <= 0) {
      return null;
    }
    if (currentRange < config.multiplier * avg) {
      return null;
    }
    // Tie-handling matches the outcome rule: close === open ⇒ "up".
    const isGreen = latest.close >= latest.open;
    return isGreen ? "down" : "up";
  },
};

registerFilter({
  filter: rangeExpansionFade as Filter<unknown>,
  defaultConfigs: () => [
    { window: 20, multiplier: 4 },
    { window: 50, multiplier: 3 },
    { window: 20, multiplier: 3 },
    { window: 50, multiplier: 2.5 },
    { window: 20, multiplier: 2.5 },
    { window: 50, multiplier: 4 },
    { window: 20, multiplier: 4.5 },
    { window: 30, multiplier: 3.5 },
    { window: 100, multiplier: 3 },
  ],
});
