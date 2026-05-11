import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { z } from "zod";

/**
 * Engulfing reversal — two-bar momentum-shift pattern. Fires when
 * the latest bar's body covers the prior bar's body and the two
 * bars have opposite colors:
 *
 *   bullish engulfing: prior bar red, current bar green AND
 *     current_body engulfs prior_body            →  predict UP
 *   bearish engulfing: prior bar green, current bar red AND
 *     current_body engulfs prior_body            →  predict DOWN
 *
 * "Engulfs" means the current body fully contains the prior body
 * vertically:
 *   - bullish: open_curr ≤ close_prev AND close_curr ≥ open_prev
 *   - bearish: open_curr ≥ close_prev AND close_curr ≤ open_prev
 *
 * Different from `pin_bar_reversal` (single-bar wick rejection) in
 * that the signal lives in the relationship BETWEEN two bars — the
 * current bar didn't just reject, it ran the prior bar's full body
 * in the opposite direction. Different from `streak_fade` (counts
 * consecutive same-color bars) in that engulfing is a 2-bar
 * direction *flip* with a magnitude qualifier, not a streak-length
 * read.
 *
 * Configurable knob: `minBodyRatio` — current body must be at least
 * this multiple of the prior body. The classic pattern uses 1.0
 * (current body strictly larger); higher ratios test "decisive"
 * engulfing only.
 */
const configSchema = z.object({
  /**
   * Minimum ratio current_body / prior_body. Use the prior body
   * floored at a small fraction of the prior range so this ratio
   * is finite for near-doji prior bars (which most engulfing-pattern
   * traders would actually still count).
   */
  minBodyRatio: z.number().positive().default(1),
});
type Config = z.infer<typeof configSchema>;

export const engulfingReversal: Filter<Config> = {
  id: "engulfing_reversal",
  version: 1,
  family: "pattern",
  description:
    "Two-bar engulfing pattern. Fires UP when the current green bar's body fully covers the prior red bar's body (and current body ≥ `minBodyRatio` × prior body); DOWN on the symmetric bearish case. Pure shape signal — no levels, no oscillators — testing whether a single decisive reversal bar predicts continued reversal at bar+1.",
  configSchema,
  requiredBars: () => 2,
  predict: (config, bars) => {
    const n = bars.length;
    if (n < 2) {
      return null;
    }
    const prev = bars[n - 2];
    const curr = bars[n - 1];
    if (prev === undefined || curr === undefined) {
      return null;
    }
    const prevBody = Math.abs(prev.close - prev.open);
    const currBody = Math.abs(curr.close - curr.open);
    const prevRange = prev.high - prev.low;
    if (prevRange <= 0) {
      return null;
    }
    // Floor the prior body so near-doji prior bars don't make the
    // ratio test trivially satisfied / divide-by-zero.
    const prevBodyForRatio = Math.max(prevBody, prevRange * 0.05);
    if (currBody / prevBodyForRatio < config.minBodyRatio) {
      return null;
    }
    // "Prior bar bearish, current bar bullish, current engulfs."
    const prevBearish = prev.close < prev.open;
    const prevBullish = prev.close > prev.open;
    const currBullish = curr.close >= curr.open;
    const currBearish = curr.close < curr.open;
    if (
      prevBearish &&
      currBullish &&
      curr.open <= prev.close &&
      curr.close >= prev.open
    ) {
      return "up";
    }
    if (
      prevBullish &&
      currBearish &&
      curr.open >= prev.close &&
      curr.close <= prev.open
    ) {
      return "down";
    }
    return null;
  },
};

registerFilter({
  filter: engulfingReversal as Filter<unknown>,
  defaultConfigs: () => [
    { minBodyRatio: 1 },
    { minBodyRatio: 0.5 },
    { minBodyRatio: 1.5 },
    { minBodyRatio: 2 },
  ],
});
