import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeBollingerSeries } from "@alea/lib/indicators/bollinger";
import { z } from "zod";

/**
 * Z-score reversion. Computes how many standard deviations the
 * latest close is above/below its trailing mean, fires the opposite
 * direction when the magnitude clears `threshold`:
 *
 *   z = (close - SMA_N) / stddev_N
 *
 * UP if `z ≤ -threshold`, DOWN if `z ≥ +threshold`, abstain otherwise.
 *
 * This is what Bollinger Bands ARE under the hood (`z = 2` ≈ the
 * 2σ pierce that `bollinger_reversion` fires on), but with the
 * threshold exposed as a continuous knob. The point is to sweep
 * `threshold` and see where the reversion edge actually peaks —
 * does it kick in at 2σ like Bollinger suggests, or earlier (1.5σ),
 * or only at deeper extremes (2.5σ, 3σ)? Cheap to test thanks to
 * the existing Bollinger helper, which already computes the rolling
 * SMA + std-dev.
 */
const configSchema = z.object({
  length: z.number().int().positive().default(20),
  /** Absolute z-score required to fire. */
  threshold: z.number().positive().default(2),
});
type Config = z.infer<typeof configSchema>;

export const zscoreReversion: Filter<Config> = {
  id: "zscore_reversion",
  version: 1,
  regime: "band_reversion",
  description:
    "Continuous-threshold reversion on the close's z-score vs trailing mean. Fires UP when z ≤ -`threshold`, DOWN when z ≥ +`threshold`. Equivalent to `bollinger_reversion` at `threshold = multiplier`, but with the threshold exposed as a continuous knob so we can find where the reversion edge actually peaks rather than locking to the textbook 2σ.",
  configSchema,
  requiredBars: (c) => c.length + 1,
  predict: (config, bars) => {
    const closes = bars.map((b) => b.close);
    // Reuse Bollinger's middle + stddev — no need for a separate
    // rolling-std helper. Multiplier is irrelevant here; we read
    // `middle` and `stddev` only.
    const { middle, stddev } = computeBollingerSeries({
      closes,
      period: config.length,
      multiplier: 1,
    });
    const i = closes.length - 1;
    const m = middle[i];
    const sd = stddev[i];
    const c = closes[i];
    if (
      m === null ||
      m === undefined ||
      sd === null ||
      sd === undefined ||
      c === undefined ||
      sd <= 0
    ) {
      return null;
    }
    const z = (c - m) / sd;
    if (z >= config.threshold) {
      return "down";
    }
    if (z <= -config.threshold) {
      return "up";
    }
    return null;
  },
};

registerFilter({
  filter: zscoreReversion as Filter<unknown>,
  defaultConfigs: () => [
    {"length":20,"threshold":3.5},
    {"length":14,"threshold":3},
    {"length":14,"threshold":2.5},
    {"length":20,"threshold":3},
    {"length":20,"threshold":2.5},
  ],
});
