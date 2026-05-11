import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeAtrSeries } from "@alea/lib/indicators/atr";
import { z } from "zod";

/**
 * Volatility burst fade. Compares the LATEST bar's true range
 * against a rolling baseline ATR; when current TR exceeds the
 * baseline by `multiplier`, fade the bar's direction:
 *
 *   tr_now / atr_baseline ≥ multiplier  →  fade close-vs-open color
 *
 * Distinct from `atr_burst_fade` (which keys off close-to-close
 * MOVE) and `range_expansion_fade` (which uses simple SMA of
 * ranges as baseline). This one uses Wilder ATR as the baseline,
 * which is smoother and dampens single-bar burst noise in the
 * threshold itself.
 */
const configSchema = z.object({
  length: z.number().int().positive().default(14),
  multiplier: z.number().positive().default(2),
});
type Config = z.infer<typeof configSchema>;

export const volatilityBurstFade: Filter<Config> = {
  id: "volatility_burst_fade",
  version: 1,
  family: "velocity_fade",
  description:
    "Fades single-bar volatility bursts. When the latest bar's true range exceeds `multiplier` × prior-bar ATR, predict the opposite of the bar's color. Wilder-ATR baseline is smoother than the simple-SMA baseline used by `range_expansion_fade`.",
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
    const baseline = atr[n - 2];
    if (baseline === null || baseline === undefined || baseline <= 0) {
      return null;
    }
    const cur = bars[n - 1]!;
    const prevClose = closes[n - 2]!;
    const tr = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prevClose),
      Math.abs(cur.low - prevClose),
    );
    if (tr < config.multiplier * baseline) {
      return null;
    }
    const isGreen = cur.close >= cur.open;
    return isGreen ? "down" : "up";
  },
};

registerFilter({
  filter: volatilityBurstFade as Filter<unknown>,
  defaultConfigs: () => [
    { length: 14, multiplier: 3 },
    { length: 14, multiplier: 2.5 },
    { length: 50, multiplier: 2.5 },
    { length: 14, multiplier: 2 },
    { length: 50, multiplier: 2 },
  ],
});
