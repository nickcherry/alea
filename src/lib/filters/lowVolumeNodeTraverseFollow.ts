import {
  bodyDirection,
  bodySize,
  closeLocation,
  meanVolume,
} from "@alea/lib/filters/_barMath";
import {
  buildVolumeProfile,
  profileBinFor,
} from "@alea/lib/filters/_volumeProfile";
import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeAtrSeries } from "@alea/lib/indicators/atr";
import { z } from "zod";

/**
 * Follows a decisive candle that traverses a low-volume node in the
 * rolling volume profile. Bins with volume below
 * `maxNodeVolPct * (total / bins)` (i.e. less than that fraction of
 * the average bin volume) are considered low-volume air pockets;
 * price entering them with body strength and close near the
 * extreme tends to keep moving.
 *
 * Signal:
 *  - Latest close lands in a low-volume node moving UP with strong
 *    body and close near high → UP
 *  - Latest close lands in a low-volume node moving DOWN with
 *    strong body and close near low → DOWN
 */
const configSchema = z.object({
  profileLookback: z.number().int().positive().default(80),
  bins: z.number().int().positive().default(24),
  maxNodeVolPct: z.number().min(0).max(1).default(0.4),
  volLength: z.number().int().positive().default(20),
  relVolMin: z.number().positive().default(1.3),
  atrLength: z.number().int().positive().default(14),
  minBodyAtr: z.number().nonnegative().default(0.4),
  minCloseLocation: z.number().min(0).max(1).default(0.75),
});
type Config = z.infer<typeof configSchema>;

export const lowVolumeNodeTraverseFollow: Filter<Config> = {
  id: "low_volume_node_traverse_follow",
  version: 1,
  barSource: "coinbase",
  family: "volume_profile_air_pocket",
  description:
    "Follows a strong candle traversing a low-volume node in the rolling profile. Up move into an air pocket → UP; down move into an air pocket → DOWN.",
  configSchema,
  requiredBars: (c) =>
    Math.max(c.profileLookback + 1, c.volLength + 1, c.atrLength + 2),
  predict: (config, bars) => {
    const n = bars.length;
    const latest = bars[n - 1];
    const prior = bars[n - 2];
    if (latest === undefined || prior === undefined) {
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
    if (bodySize(latest) < config.minBodyAtr * atr) {
      return null;
    }
    const cl = closeLocation(latest);
    if (cl === null) {
      return null;
    }
    const binIdx = profileBinFor({ profile, price: latest.close });
    if (binIdx === null) {
      return null;
    }
    const binVolume = profile.bins[binIdx];
    if (binVolume === undefined) {
      return null;
    }
    const avgBinVolume = profile.total / profile.bins.length;
    if (avgBinVolume <= 0) {
      return null;
    }
    if (binVolume / avgBinVolume >= config.maxNodeVolPct) {
      return null;
    }
    const direction = bodyDirection(latest);
    if (direction === null) {
      return null;
    }
    if (
      direction === "up" &&
      latest.close > prior.close &&
      cl >= config.minCloseLocation
    ) {
      return "up";
    }
    if (
      direction === "down" &&
      latest.close < prior.close &&
      1 - cl >= config.minCloseLocation
    ) {
      return "down";
    }
    return null;
  },
};

registerFilter({
  filter: lowVolumeNodeTraverseFollow as Filter<unknown>,
  defaultConfigs: () => [
    { profileLookback: 80, bins: 24, maxNodeVolPct: 0.4, volLength: 20, relVolMin: 1.3, atrLength: 14, minBodyAtr: 0.4, minCloseLocation: 0.75 },
    { profileLookback: 120, bins: 30, maxNodeVolPct: 0.35, volLength: 20, relVolMin: 1.6, atrLength: 14, minBodyAtr: 0.5, minCloseLocation: 0.8 },
    { profileLookback: 50, bins: 20, maxNodeVolPct: 0.45, volLength: 20, relVolMin: 1.8, atrLength: 7, minBodyAtr: 0.35, minCloseLocation: 0.75 },
    { profileLookback: 160, bins: 36, maxNodeVolPct: 0.3, volLength: 50, relVolMin: 1.4, atrLength: 20, minBodyAtr: 0.6, minCloseLocation: 0.75 },
    { profileLookback: 100, bins: 24, maxNodeVolPct: 0.35, volLength: 50, relVolMin: 2.0, atrLength: 14, minBodyAtr: 0.5, minCloseLocation: 0.85 },
  ],
});
