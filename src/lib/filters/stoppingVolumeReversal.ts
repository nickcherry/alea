import {
  barRange,
  bodyFraction,
  bodySize,
  meanVolume,
} from "@alea/lib/filters/_barMath";
import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeAtrSeries } from "@alea/lib/indicators/atr";
import { z } from "zod";

/**
 * Stopping-volume reversal. Price pushes hard into a low or high,
 * volume explodes, but price rejects the extreme — wide range
 * with a long wick on the rejection side and a small body. Often
 * absorption.
 *
 * Signal:
 *  - High-volume lower-wick rejection → UP
 *  - High-volume upper-wick rejection → DOWN
 *
 * Knobs:
 *  - `volLength`, `relVolMin`: relative-volume gate.
 *  - `atrLength`, `minRangeAtr`: bar must be wide enough.
 *  - `minWickRatio`: the rejection-side wick must be at least
 *    `minWickRatio` times the body.
 *  - `maxBodyFraction`: body must be small relative to the range.
 *  - `minRejectionFrac`: the rejection-side wick must be at least
 *    this fraction of the bar's full range.
 */
const configSchema = z.object({
  volLength: z.number().int().positive().default(20),
  relVolMin: z.number().positive().default(2.0),
  atrLength: z.number().int().positive().default(14),
  minRangeAtr: z.number().nonnegative().default(0.8),
  minWickRatio: z.number().nonnegative().default(2.5),
  maxBodyFraction: z.number().min(0).max(1).default(0.35),
  minRejectionFrac: z.number().min(0).max(1).default(0.45),
});
type Config = z.infer<typeof configSchema>;

export const stoppingVolumeReversal: Filter<Config> = {
  id: "stopping_volume_reversal",
  version: 1,
  barSource: "coinbase",
  family: "volume_absorption_reversion",
  description:
    "High-volume wick rejection at an extreme. Lower-wick rejection on a wide-range, small-body bar predicts UP; upper-wick rejection predicts DOWN.",
  configSchema,
  requiredBars: (c) => Math.max(c.volLength + 1, c.atrLength + 2),
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
    const range = barRange(latest);
    if (range < config.minRangeAtr * atr) {
      return null;
    }
    const bodyFrac = bodyFraction(latest);
    if (bodyFrac === null || bodyFrac > config.maxBodyFraction) {
      return null;
    }
    const body = bodySize(latest);
    const bodyHigh = Math.max(latest.open, latest.close);
    const bodyLow = Math.min(latest.open, latest.close);
    const upperWick = latest.high - bodyHigh;
    const lowerWick = bodyLow - latest.low;
    // Compare wick to body using the minWickRatio. If the body is
    // ~zero (doji), require the wick to clear minRejectionFrac of
    // the range instead — we don't want to bail on a doji-style
    // rejection just because the body is tiny.
    const ratioFloor = body > 0 ? config.minWickRatio * body : Infinity;
    if (lowerWick >= ratioFloor && lowerWick / range >= config.minRejectionFrac) {
      return "up";
    }
    if (upperWick >= ratioFloor && upperWick / range >= config.minRejectionFrac) {
      return "down";
    }
    if (body === 0) {
      // Pure doji: pick the larger wick if it clears the fraction floor.
      if (
        lowerWick > upperWick &&
        lowerWick / range >= config.minRejectionFrac
      ) {
        return "up";
      }
      if (
        upperWick > lowerWick &&
        upperWick / range >= config.minRejectionFrac
      ) {
        return "down";
      }
    }
    return null;
  },
};

registerFilter({
  filter: stoppingVolumeReversal as Filter<unknown>,
  defaultConfigs: () => [
    {
      volLength: 20,
      relVolMin: 2.0,
      atrLength: 14,
      minRangeAtr: 0.8,
      minWickRatio: 2.5,
      maxBodyFraction: 0.35,
      minRejectionFrac: 0.45,
    },
    {
      volLength: 20,
      relVolMin: 3.0,
      atrLength: 14,
      minRangeAtr: 1.0,
      minWickRatio: 3.0,
      maxBodyFraction: 0.3,
      minRejectionFrac: 0.5,
    },
    {
      volLength: 50,
      relVolMin: 2.0,
      atrLength: 14,
      minRangeAtr: 0.8,
      minWickRatio: 2.0,
      maxBodyFraction: 0.4,
      minRejectionFrac: 0.4,
    },
    {
      volLength: 20,
      relVolMin: 4.0,
      atrLength: 7,
      minRangeAtr: 0.7,
      minWickRatio: 3.5,
      maxBodyFraction: 0.25,
      minRejectionFrac: 0.55,
    },
    {
      volLength: 50,
      relVolMin: 2.5,
      atrLength: 20,
      minRangeAtr: 1.2,
      minWickRatio: 2.5,
      maxBodyFraction: 0.35,
      minRejectionFrac: 0.45,
    },
  ],
});
