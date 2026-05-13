import {
  bodyDirection,
  bodyFraction,
  bodySize,
  closeLocation,
  meanVolume,
} from "@alea/lib/filters/_barMath";
import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeAtrSeries } from "@alea/lib/indicators/atr";
import { z } from "zod";

/**
 * Fresh high-volume impulse follow. The opposite hypothesis to
 * late_volume_climax_fade: a high-relative-volume directional bar
 * with strong body and close-near-extreme is a real impulse if the
 * move is fresh — i.e. there are at most `maxPriorSameColor`
 * same-direction bars immediately preceding it.
 *
 * Signal:
 *  - Fresh strong green impulse → UP
 *  - Fresh strong red impulse → DOWN
 *
 * Knobs:
 *  - `volLength`: SMA window for relative-volume baseline.
 *  - `relVolMin`: latest bar must exceed this multiple of avg volume.
 *  - `atrLength`: ATR window.
 *  - `minBodyAtr`: latest bar body must be at least this many ATRs.
 *  - `minBodyFraction`: latest bar's body/range ratio must clear this.
 *  - `minCloseLocation`: close must sit in the top fraction of the
 *    bar's range for UP, or the bottom for DOWN.
 *  - `maxPriorSameColor`: count of consecutive same-direction bars
 *    immediately before the latest. More than this and we treat it
 *    as a late impulse (this filter abstains; the late-climax fade
 *    is the other side of that hypothesis).
 */
const configSchema = z.object({
  volLength: z.number().int().positive().default(20),
  relVolMin: z.number().positive().default(1.8),
  atrLength: z.number().int().positive().default(14),
  minBodyAtr: z.number().nonnegative().default(0.5),
  minBodyFraction: z.number().min(0).max(1).default(0.65),
  minCloseLocation: z.number().min(0).max(1).default(0.8),
  maxPriorSameColor: z.number().int().nonnegative().default(1),
});
type Config = z.infer<typeof configSchema>;

export const freshVolumeImpulseFollow: Filter<Config> = {
  id: "fresh_volume_impulse_follow",
  version: 1,
  barSource: "coinbase",
  family: "volume_momentum_continuation",
  description:
    "Follows a fresh high-volume impulse with strong body and close near the extreme, gated on at most `maxPriorSameColor` same-direction predecessors so it's a fresh push, not a late one.",
  configSchema,
  requiredBars: (c) =>
    Math.max(c.volLength + 1, c.atrLength + 2, c.maxPriorSameColor + 2),
  predict: (config, bars) => {
    const n = bars.length;
    const latest = bars[n - 1];
    if (latest === undefined) {
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
    const body = bodyFraction(latest);
    if (body === null || body < config.minBodyFraction) {
      return null;
    }
    if (bodySize(latest) < config.minBodyAtr * atr) {
      return null;
    }
    const direction = bodyDirection(latest);
    if (direction === null) {
      return null;
    }
    const cl = closeLocation(latest);
    if (cl === null) {
      return null;
    }
    if (direction === "up" && cl < config.minCloseLocation) {
      return null;
    }
    if (direction === "down" && 1 - cl < config.minCloseLocation) {
      return null;
    }
    let priorSame = 0;
    for (let i = n - 2; i >= 0 && i >= n - 2 - config.maxPriorSameColor; i -= 1) {
      const bar = bars[i];
      if (bar === undefined) {
        break;
      }
      if (bodyDirection(bar) !== direction) {
        break;
      }
      priorSame += 1;
    }
    if (priorSame > config.maxPriorSameColor) {
      return null;
    }
    return direction === "up" ? "up" : "down";
  },
};

registerFilter({
  filter: freshVolumeImpulseFollow as Filter<unknown>,
  defaultConfigs: () => [
    {
      volLength: 20,
      relVolMin: 1.8,
      atrLength: 14,
      minBodyAtr: 0.5,
      minBodyFraction: 0.65,
      minCloseLocation: 0.8,
      maxPriorSameColor: 1,
    },
    {
      volLength: 20,
      relVolMin: 2.2,
      atrLength: 14,
      minBodyAtr: 0.7,
      minBodyFraction: 0.6,
      minCloseLocation: 0.8,
      maxPriorSameColor: 2,
    },
    {
      volLength: 50,
      relVolMin: 1.8,
      atrLength: 14,
      minBodyAtr: 0.8,
      minBodyFraction: 0.55,
      minCloseLocation: 0.75,
      maxPriorSameColor: 2,
    },
    {
      volLength: 20,
      relVolMin: 2.5,
      atrLength: 7,
      minBodyAtr: 0.6,
      minBodyFraction: 0.7,
      minCloseLocation: 0.85,
      maxPriorSameColor: 1,
    },
    {
      volLength: 50,
      relVolMin: 2.0,
      atrLength: 20,
      minBodyAtr: 1.0,
      minBodyFraction: 0.55,
      minCloseLocation: 0.75,
      maxPriorSameColor: 3,
    },
  ],
});
