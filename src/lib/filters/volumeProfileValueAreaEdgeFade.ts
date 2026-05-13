import { meanVolume } from "@alea/lib/filters/_barMath";
import {
  buildVolumeProfile,
  valueArea,
} from "@alea/lib/filters/_volumeProfile";
import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeAtrSeries } from "@alea/lib/indicators/atr";
import { z } from "zod";

/**
 * Fades rejections at the rolling volume-profile value-area edges.
 * Builds a coarse profile from typical-price binning over
 * `profileLookback` bars (exclusive of latest), resolves the value
 * area covering `valueAreaPct` of total volume around the POC, and
 * checks the latest bar for a wick-rejection right at the VAH or
 * VAL.
 *
 * Signal:
 *  - Latest tests VAH (within `toleranceAtr` ATRs) + closes back
 *    inside + upper wick clears `minRejectionFrac` → DOWN
 *  - Latest tests VAL + closes back inside + lower wick → UP
 */
const configSchema = z.object({
  profileLookback: z.number().int().positive().default(80),
  bins: z.number().int().positive().default(24),
  valueAreaPct: z.number().min(0).max(1).default(0.7),
  volLength: z.number().int().positive().default(20),
  relVolMin: z.number().positive().default(1.0),
  atrLength: z.number().int().positive().default(14),
  toleranceAtr: z.number().nonnegative().default(0.2),
  minRejectionFrac: z.number().min(0).max(1).default(0.35),
});
type Config = z.infer<typeof configSchema>;

export const volumeProfileValueAreaEdgeFade: Filter<Config> = {
  id: "volume_profile_value_area_edge_fade",
  version: 1,
  barSource: "coinbase",
  family: "volume_profile_reversion",
  description:
    "Fades rejections at the rolling volume-profile value-area edges. VAH tap + upper-wick rejection → DOWN; VAL tap + lower-wick rejection → UP.",
  configSchema,
  requiredBars: (c) =>
    Math.max(c.profileLookback + 1, c.volLength + 1, c.atrLength + 2),
  predict: (config, bars) => {
    const n = bars.length;
    const latest = bars[n - 1];
    if (latest === undefined) {
      return null;
    }
    const profile = buildVolumeProfile({
      bars,
      start: n - 1 - config.profileLookback,
      endExclusive: n - 1,
      bins: config.bins,
    });
    if (profile === null) {
      return null;
    }
    const area = valueArea({ profile, valueAreaPct: config.valueAreaPct });
    if (area === null) {
      return null;
    }
    const avgVolume = meanVolume({
      bars,
      start: n - 1 - config.volLength,
      endExclusive: n - 1,
    });
    if (avgVolume === null || avgVolume <= 0) {
      return null;
    }
    if (latest.volume / avgVolume < config.relVolMin) {
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
    const tolerance = config.toleranceAtr * atr;
    const range = latest.high - latest.low;
    if (range <= 0) {
      return null;
    }
    const bodyHigh = Math.max(latest.open, latest.close);
    const bodyLow = Math.min(latest.open, latest.close);
    const upperWick = latest.high - bodyHigh;
    const lowerWick = bodyLow - latest.low;
    // VAH test + close back inside + upper-wick rejection.
    if (
      Math.abs(latest.high - area.vahPrice) <= tolerance &&
      latest.close < area.vahPrice &&
      upperWick / range >= config.minRejectionFrac
    ) {
      return "down";
    }
    if (
      Math.abs(latest.low - area.valPrice) <= tolerance &&
      latest.close > area.valPrice &&
      lowerWick / range >= config.minRejectionFrac
    ) {
      return "up";
    }
    return null;
  },
};

registerFilter({
  filter: volumeProfileValueAreaEdgeFade as Filter<unknown>,
  defaultConfigs: () => [
    { profileLookback: 80, bins: 24, valueAreaPct: 0.7, volLength: 20, relVolMin: 1.0, atrLength: 14, toleranceAtr: 0.2, minRejectionFrac: 0.35 },
    { profileLookback: 120, bins: 30, valueAreaPct: 0.7, volLength: 50, relVolMin: 1.2, atrLength: 14, toleranceAtr: 0.25, minRejectionFrac: 0.4 },
    { profileLookback: 50, bins: 20, valueAreaPct: 0.68, volLength: 20, relVolMin: 1.5, atrLength: 7, toleranceAtr: 0.15, minRejectionFrac: 0.45 },
    { profileLookback: 160, bins: 36, valueAreaPct: 0.7, volLength: 50, relVolMin: 1.0, atrLength: 20, toleranceAtr: 0.3, minRejectionFrac: 0.35 },
    { profileLookback: 100, bins: 24, valueAreaPct: 0.75, volLength: 20, relVolMin: 1.3, atrLength: 14, toleranceAtr: 0.2, minRejectionFrac: 0.5 },
  ],
});
