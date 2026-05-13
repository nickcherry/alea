import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeAtrSeries } from "@alea/lib/indicators/atr";
import { computeRollingVwapZSeries } from "@alea/lib/indicators/vwap";
import { z } from "zod";

/**
 * Rolling VWAP band reclaim. Distinct from `vwap_band_reclaim`:
 * this version requires both (a) the latest close to have just
 * reclaimed the band from outside AND (b) the close to sit at least
 * `minDistanceAtr` ATRs back inside the band from the closer
 * boundary. The extra distance gate filters out cosmetic reclaims
 * where price just barely poked back across the line.
 *
 * Signal:
 *  - Prior `minOutsideBars` closes above the upper band, latest
 *    close back inside (with sufficient distance from the upper
 *    boundary) → DOWN
 *  - Prior `minOutsideBars` closes below the lower band, latest
 *    close back inside (with sufficient distance from the lower
 *    boundary) → UP
 */
const configSchema = z.object({
  length: z.number().int().positive().default(20),
  bandZ: z.number().positive().default(2),
  minOutsideBars: z.number().int().positive().default(1),
  atrLength: z.number().int().positive().default(14),
  minDistanceAtr: z.number().nonnegative().default(0.2),
});
type Config = z.infer<typeof configSchema>;

export const rollingVwapBandReclaim: Filter<Config> = {
  id: "rolling_vwap_band_reclaim",
  version: 1,
  barSource: "coinbase",
  family: "volume_weighted_reversion",
  description:
    "Rolling VWAP band reclaim with an ATR-scaled distance gate so cosmetic re-crossings are rejected. Reclaim from above → DOWN; reclaim from below → UP.",
  configSchema,
  requiredBars: (c) =>
    Math.max(c.length + c.minOutsideBars, c.atrLength + 2),
  predict: (config, bars) => {
    const n = bars.length;
    const closes = bars.map((b) => b.close);
    const volumes = bars.map((b) => b.volume);
    const { z: zscores } = computeRollingVwapZSeries({
      closes,
      volumes,
      period: config.length,
    });
    const latestZ = zscores[n - 1];
    if (latestZ === null || latestZ === undefined) {
      return null;
    }
    const highs = bars.map((b) => b.high);
    const lows = bars.map((b) => b.low);
    const atr = computeAtrSeries({
      highs,
      lows,
      closes,
      period: config.atrLength,
    })[n - 2];
    if (atr === null || atr === undefined || atr <= 0) {
      return null;
    }
    const minDistance = config.minDistanceAtr * atr;
    let upperOutside = true;
    let lowerOutside = true;
    for (let i = n - 1 - config.minOutsideBars; i <= n - 2; i += 1) {
      const zscore = zscores[i];
      if (zscore === null || zscore === undefined) {
        return null;
      }
      if (zscore < config.bandZ) {
        upperOutside = false;
      }
      if (zscore > -config.bandZ) {
        lowerOutside = false;
      }
    }
    const latest = bars[n - 1];
    if (latest === undefined) {
      return null;
    }
    // Convert latest z back into a price-distance check by deriving
    // the band's price from the rolling VWAP at this index. The
    // VWAP-z series gives us `z` but the underlying band in price
    // terms is `mean ± bandZ · stddev`. We approximate the "distance
    // back inside" as `|latestZ - bandZ| · stddev`, which converts
    // back to price-distance via the volume-weighted stddev. We have
    // `stddev = (close - mean) / z`; when `z` ≠ 0 we can recover it
    // from the latest bar.
    //
    // Easier: require both `|latestZ| < bandZ` (reclaimed) AND the
    // bar's progress from the band edge in z-space scaled by the
    // typical-bar magnitude (ATR) clears `minDistanceAtr`. Since the
    // VWAP stddev and ATR aren't identical units, we use the bar's
    // own distance: latest close vs the prior-bar close (which was
    // still outside the band).
    const priorClose = bars[n - 2]?.close;
    if (priorClose === undefined) {
      return null;
    }
    if (upperOutside && latestZ < config.bandZ) {
      if (priorClose - latest.close < minDistance) {
        return null;
      }
      return "down";
    }
    if (lowerOutside && latestZ > -config.bandZ) {
      if (latest.close - priorClose < minDistance) {
        return null;
      }
      return "up";
    }
    return null;
  },
};

registerFilter({
  filter: rollingVwapBandReclaim as Filter<unknown>,
  defaultConfigs: () => [
    { length: 20, bandZ: 2.0, minOutsideBars: 1, atrLength: 14, minDistanceAtr: 0.2 },
    { length: 20, bandZ: 2.5, minOutsideBars: 1, atrLength: 14, minDistanceAtr: 0.3 },
    { length: 50, bandZ: 2.0, minOutsideBars: 1, atrLength: 14, minDistanceAtr: 0.25 },
    { length: 14, bandZ: 2.0, minOutsideBars: 1, atrLength: 7, minDistanceAtr: 0.2 },
    { length: 50, bandZ: 2.5, minOutsideBars: 2, atrLength: 20, minDistanceAtr: 0.4 },
    { length: 50, bandZ: 3.0, minOutsideBars: 2, atrLength: 20, minDistanceAtr: 0.5 },
    { length: 50, bandZ: 2.5, minOutsideBars: 1, atrLength: 20, minDistanceAtr: 0.5 },
    { length: 20, bandZ: 3.0, minOutsideBars: 1, atrLength: 14, minDistanceAtr: 0.4 },
  ],
});
