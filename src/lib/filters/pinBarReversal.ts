import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { z } from "zod";

/**
 * Pin bar reversal — pure single-bar shape filter. A "pin bar" is
 * a candle with a long wick on one side and a small body near the
 * opposite end:
 *
 *   bullish pin: long LOWER wick, tiny body in the upper part of
 *                the range → bulls rejected the lows → predict UP
 *   bearish pin: long UPPER wick, tiny body in the lower part of
 *                the range → bears rejected the highs → predict DOWN
 *
 * Trigger conditions (configurable, defaults in parentheses):
 *
 *   - `body / range ≤ maxBodyFraction`     (0.33)
 *   - `dominantWick / body ≥ minWickRatio` (2.0)
 *   - `oppositeWick / range ≤ maxOppositeWickFraction` (0.25)
 *
 * This is the first filter in the registry that tests *candle shape*
 * directly, with no reference to a moving average, oscillator, or
 * level. Hypothesis: shape alone carries reversal signal because a
 * long wick is the visible imprint of price testing-then-failing
 * a level — even when our level-based filters don't fire on the
 * same bar. If WR comes in the 53-56% band, shape is roughly as
 * informative as a single oscillator extreme. If it underperforms,
 * the shape signal is already absorbed by the level-based family
 * (price near a band).
 *
 * Tie-handling: `close == open` is treated as bullish (body = 0
 * counts as upper-side, matching the "0 rounds up" rule used by
 * the outcome scorer). With zero body, the wick-ratio condition
 * becomes `wick ≥ 0` which is trivially satisfied, so the body
 * size guard is the actual gate.
 */
const configSchema = z.object({
  /** Max body / range ratio. Smaller = stricter (tinier body). */
  maxBodyFraction: z.number().positive().default(0.33),
  /**
   * Min ratio of dominant wick to body. Higher = stricter (wick
   * dominates body more decisively). Use a body floor inside the
   * filter so this ratio doesn't explode on near-zero bodies.
   */
  minWickRatio: z.number().positive().default(2),
  /** Max opposite-wick / range ratio. Smaller = stricter (the
   * pattern is more clearly one-sided). */
  maxOppositeWickFraction: z.number().positive().default(0.25),
});
type Config = z.infer<typeof configSchema>;

export const pinBarReversal: Filter<Config> = {
  id: "pin_bar_reversal",
  version: 1,
  regime: "pattern",
  description:
    "Single-bar shape filter. Fires UP on a bullish pin bar (long lower wick, tiny body near the high) and DOWN on a bearish pin bar (long upper wick, tiny body near the low). First shape-only filter in the registry — tests whether candle shape carries reversal signal beyond what level / oscillator filters already see.",
  configSchema,
  requiredBars: () => 1,
  predict: (config, bars) => {
    const bar = bars[bars.length - 1];
    if (bar === undefined) {
      return null;
    }
    const range = bar.high - bar.low;
    if (range <= 0) {
      return null;
    }
    const body = Math.abs(bar.close - bar.open);
    if (body / range > config.maxBodyFraction) {
      return null;
    }
    const bodyTop = Math.max(bar.open, bar.close);
    const bodyBottom = Math.min(bar.open, bar.close);
    const upperWick = bar.high - bodyTop;
    const lowerWick = bodyBottom - bar.low;
    // Floor the body so the wick-ratio test is meaningful on doji.
    // Pick max(body, 1bp-of-range) — 1bp is a token "no zero
    // division" guard; in practice the maxBodyFraction filter has
    // already accepted us above zero body widths.
    const bodyForRatio = Math.max(body, range * 0.0001);
    // Bullish pin: lower wick dominates.
    if (
      lowerWick / bodyForRatio >= config.minWickRatio &&
      upperWick / range <= config.maxOppositeWickFraction
    ) {
      return "up";
    }
    // Bearish pin: upper wick dominates.
    if (
      upperWick / bodyForRatio >= config.minWickRatio &&
      lowerWick / range <= config.maxOppositeWickFraction
    ) {
      return "down";
    }
    return null;
  },
};

registerFilter({
  filter: pinBarReversal as Filter<unknown>,
  defaultConfigs: () => [
    {"minWickRatio":4,"maxBodyFraction":0.1,"maxOppositeWickFraction":0.1},
    {"minWickRatio":3,"maxBodyFraction":0.15,"maxOppositeWickFraction":0.15},
    {"minWickRatio":3,"maxBodyFraction":0.2,"maxOppositeWickFraction":0.15},
    {"minWickRatio":2.5,"maxBodyFraction":0.25,"maxOppositeWickFraction":0.2},
    {"minWickRatio":2,"maxBodyFraction":0.33,"maxOppositeWickFraction":0.25},
  ],
});
