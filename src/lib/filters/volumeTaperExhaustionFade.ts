import { meanVolume } from "@alea/lib/filters/_barMath";
import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeAtrSeries } from "@alea/lib/indicators/atr";
import { z } from "zod";

/**
 * Fades a trend whose volume is tapering. Over the trailing
 * `lookback`, relative volume must slope downward (per-bar slope ≤
 * `maxVolSlope`, a negative number), the latest relVol must be
 * below `maxRelVolEnd`, and the net close-to-close move must clear
 * `minPriceMoveAtr` ATRs. Whichever direction price moved is the
 * one we fade.
 */
const configSchema = z.object({
  lookback: z.number().int().positive().default(8),
  volLength: z.number().int().positive().default(20),
  atrLength: z.number().int().positive().default(14),
  minPriceMoveAtr: z.number().nonnegative().default(0.8),
  maxRelVolEnd: z.number().positive().default(0.9),
  maxVolSlope: z.number().default(-0.05),
});
type Config = z.infer<typeof configSchema>;

export const volumeTaperExhaustionFade: Filter<Config> = {
  id: "volume_taper_exhaustion_fade",
  version: 1,
  barSource: "coinbase",
  family: "volume_divergence_reversion",
  description:
    "Fades trends whose volume is tapering. Price grinds in a direction over the lookback while relative volume slopes down; fade in the opposite direction.",
  configSchema,
  requiredBars: (c) =>
    Math.max(c.lookback + c.volLength + 1, c.atrLength + 2, c.lookback + 1),
  predict: (config, bars) => {
    const n = bars.length;
    const latest = bars[n - 1];
    if (latest === undefined) {
      return null;
    }
    const highs = bars.map((b) => b.high);
    const lows = bars.map((b) => b.low);
    const closes = bars.map((b) => b.close);
    const atr = computeAtrSeries({
      highs,
      lows,
      closes,
      period: config.atrLength,
    })[n - 2];
    if (atr === null || atr === undefined || atr <= 0) {
      return null;
    }
    const startIdx = n - config.lookback;
    if (startIdx - config.volLength < 0) {
      return null;
    }
    let startRelVol: number | null = null;
    let endRelVol: number | null = null;
    for (let i = startIdx; i <= n - 1; i += 1) {
      const bar = bars[i];
      if (bar === undefined) {
        return null;
      }
      const avg = meanVolume({
        bars,
        start: i - config.volLength,
        endExclusive: i,
      });
      if (avg === null || avg <= 0) {
        return null;
      }
      const rel = bar.volume / avg;
      if (i === startIdx) {
        startRelVol = rel;
      }
      if (i === n - 1) {
        endRelVol = rel;
      }
    }
    if (startRelVol === null || endRelVol === null) {
      return null;
    }
    if (endRelVol > config.maxRelVolEnd) {
      return null;
    }
    const slope = (endRelVol - startRelVol) / config.lookback;
    if (slope > config.maxVolSlope) {
      return null;
    }
    const firstClose = bars[startIdx - 1]?.close;
    if (firstClose === undefined) {
      return null;
    }
    const netMove = latest.close - firstClose;
    const minMove = config.minPriceMoveAtr * atr;
    if (netMove >= minMove) {
      return "down";
    }
    if (-netMove >= minMove) {
      return "up";
    }
    return null;
  },
};

registerFilter({
  filter: volumeTaperExhaustionFade as Filter<unknown>,
  defaultConfigs: () => [
    { lookback: 8, volLength: 20, atrLength: 14, minPriceMoveAtr: 0.8, maxRelVolEnd: 0.9, maxVolSlope: -0.05 },
    { lookback: 12, volLength: 20, atrLength: 14, minPriceMoveAtr: 1.2, maxRelVolEnd: 0.8, maxVolSlope: -0.04 },
    { lookback: 20, volLength: 50, atrLength: 14, minPriceMoveAtr: 1.8, maxRelVolEnd: 0.75, maxVolSlope: -0.03 },
    { lookback: 6, volLength: 20, atrLength: 7, minPriceMoveAtr: 0.7, maxRelVolEnd: 0.85, maxVolSlope: -0.06 },
    { lookback: 15, volLength: 50, atrLength: 20, minPriceMoveAtr: 1.5, maxRelVolEnd: 0.8, maxVolSlope: -0.04 },
  ],
});
