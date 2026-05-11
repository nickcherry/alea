import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeBollingerSeries } from "@alea/lib/indicators/bollinger";
import { z } from "zod";

/**
 * Bollinger %B mean reversion.
 *
 *   %B = (close - lower) / (upper - lower)
 *
 * `%B = 0` is at the lower band; `%B = 1` is at the upper band;
 * `%B < 0` or `%B > 1` is *past* the bands. Predicts UP when
 * `%B ≤ lowerEnter` (price punched through the bottom — revert
 * up), DOWN when `%B ≥ upperEnter` (price punched through the top
 * — revert down).
 *
 * This is the continuous version of `bollinger_reversion`. That one
 * fires the instant close crosses the band (a binary event); %B
 * exposes "how far past" as a tunable knob. Tests whether the
 * sweet spot for reversion is "just barely through" (%B ≈ 0) or
 * "well past" (%B ≈ -0.1).
 */
const configSchema = z.object({
  length: z.number().int().positive().default(20),
  multiplier: z.number().positive().default(2),
  /** Fire UP when %B is at or below this. 0 = at lower band, negative = past it. */
  lowerEnter: z.number().default(0),
  /** Fire DOWN when %B is at or above this. 1 = at upper band, > 1 = past it. */
  upperEnter: z.number().default(1),
});
type Config = z.infer<typeof configSchema>;

export const bollingerPercentB: Filter<Config> = {
  id: "bollinger_percent_b",
  version: 1,
  regime: "band_reversion",
  description:
    "Bollinger %B reversion. %B reads as 0 at the lower band, 1 at the upper band, negative below the lower band, > 1 above the upper band. Fires UP when %B ≤ `lowerEnter`, DOWN when %B ≥ `upperEnter`. Continuous-threshold sibling of `bollinger_reversion`: that one fires the instant the close crosses; this one lets you tune 'how far past' the band counts as a signal.",
  configSchema,
  requiredBars: (c) => c.length + 1,
  predict: (config, bars) => {
    const closes = bars.map((b) => b.close);
    const { upper, lower } = computeBollingerSeries({
      closes,
      period: config.length,
      multiplier: config.multiplier,
    });
    const i = closes.length - 1;
    const u = upper[i];
    const l = lower[i];
    const c = closes[i];
    if (
      u === null ||
      u === undefined ||
      l === null ||
      l === undefined ||
      c === undefined ||
      u <= l
    ) {
      return null;
    }
    const percentB = (c - l) / (u - l);
    if (percentB <= config.lowerEnter) {
      return "up";
    }
    if (percentB >= config.upperEnter) {
      return "down";
    }
    return null;
  },
};

registerFilter({
  filter: bollingerPercentB as Filter<unknown>,
  defaultConfigs: () => [
    {"length":20,"lowerEnter":-0.2,"multiplier":2,"upperEnter":1.2},
    {"length":20,"lowerEnter":-0.1,"multiplier":2.5,"upperEnter":1.1},
    {"length":20,"lowerEnter":-0.15,"multiplier":2,"upperEnter":1.15},
    {"length":20,"lowerEnter":0,"multiplier":2.5,"upperEnter":1},
    {"length":20,"lowerEnter":-0.1,"multiplier":2,"upperEnter":1.1},
  ],
});
