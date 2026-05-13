import {
  highestHigh,
  lowestLow,
  meanVolume,
} from "@alea/lib/filters/_barMath";
import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeAtrSeries } from "@alea/lib/indicators/atr";
import { z } from "zod";

/**
 * High-volume failed-breakout fade. Price sweeps a prior extreme on
 * high relative volume but fails to close meaningfully beyond it,
 * leaving a rejection wick. Classic absorption — participation
 * showed up at the extreme but the dominant side couldn't extend.
 *
 *  - `lookback`: prior-extreme window (exclusive of latest).
 *  - `relVolMin`: minimum `latest.volume / SMA(volume, volLength)`.
 *  - `minSweepAtr`: minimum penetration of the prior extreme by
 *    high/low in ATRs.
 *  - `maxCloseBeyondAtr`: ceiling on how far the CLOSE may sit
 *    beyond the prior extreme in ATRs. 0 means the close must be
 *    at or back inside the level.
 *  - `minRejectionFrac`: the rejection-side wick must be at least
 *    this fraction of the bar's range.
 *
 * Signal:
 *  - Upper sweep + close-back-inside + upper-wick rejection → DOWN
 *  - Lower sweep + close-back-inside + lower-wick rejection → UP
 */
const configSchema = z.object({
  lookback: z.number().int().positive().default(20),
  volLength: z.number().int().positive().default(20),
  relVolMin: z.number().positive().default(1.8),
  atrLength: z.number().int().positive().default(14),
  minSweepAtr: z.number().nonnegative().default(0.05),
  maxCloseBeyondAtr: z.number().nonnegative().default(0),
  minRejectionFrac: z.number().min(0).max(1).default(0.4),
});
type Config = z.infer<typeof configSchema>;

export const highVolumeFailedBreakoutFade: Filter<Config> = {
  id: "high_volume_failed_breakout_fade",
  version: 1,
  barSource: "coinbase",
  family: "volume_absorption_failure",
  description:
    "Fades a high-volume sweep of a prior swing extreme that fails to close beyond the level. Upper sweep + rejection → DOWN; lower sweep + rejection → UP.",
  configSchema,
  requiredBars: (c) =>
    Math.max(c.lookback + 1, c.volLength + 1, c.atrLength + 2),
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
    const priorHigh = highestHigh({
      bars,
      start: n - 1 - config.lookback,
      endExclusive: n - 1,
    });
    const priorLow = lowestLow({
      bars,
      start: n - 1 - config.lookback,
      endExclusive: n - 1,
    });
    if (priorHigh === null || priorLow === null) {
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
    const range = latest.high - latest.low;
    if (range <= 0) {
      return null;
    }
    const bodyHigh = Math.max(latest.open, latest.close);
    const bodyLow = Math.min(latest.open, latest.close);
    const upperWick = latest.high - bodyHigh;
    const lowerWick = bodyLow - latest.low;
    const minSweep = config.minSweepAtr * atr;
    const maxCloseBeyond = config.maxCloseBeyondAtr * atr;
    if (
      latest.high - priorHigh >= minSweep &&
      latest.close - priorHigh <= maxCloseBeyond &&
      upperWick / range >= config.minRejectionFrac
    ) {
      return "down";
    }
    if (
      priorLow - latest.low >= minSweep &&
      priorLow - latest.close <= maxCloseBeyond &&
      lowerWick / range >= config.minRejectionFrac
    ) {
      return "up";
    }
    return null;
  },
};

registerFilter({
  filter: highVolumeFailedBreakoutFade as Filter<unknown>,
  defaultConfigs: () => [
    { lookback: 20, volLength: 20, relVolMin: 1.8, atrLength: 14, minSweepAtr: 0.05, maxCloseBeyondAtr: 0, minRejectionFrac: 0.4 },
    { lookback: 20, volLength: 20, relVolMin: 2.5, atrLength: 14, minSweepAtr: 0.1, maxCloseBeyondAtr: 0, minRejectionFrac: 0.45 },
    { lookback: 50, volLength: 50, relVolMin: 2.0, atrLength: 14, minSweepAtr: 0.1, maxCloseBeyondAtr: 0.03, minRejectionFrac: 0.4 },
    { lookback: 14, volLength: 20, relVolMin: 3.0, atrLength: 7, minSweepAtr: 0.05, maxCloseBeyondAtr: 0, minRejectionFrac: 0.5 },
    { lookback: 30, volLength: 50, relVolMin: 2.2, atrLength: 20, minSweepAtr: 0.15, maxCloseBeyondAtr: 0.05, minRejectionFrac: 0.45 },
    // Push longer lookbacks + slight close-beyond tolerance + moderate relVol.
    { lookback: 80, volLength: 50, relVolMin: 1.8, atrLength: 14, minSweepAtr: 0.1, maxCloseBeyondAtr: 0.05, minRejectionFrac: 0.4 },
    { lookback: 60, volLength: 50, relVolMin: 2.0, atrLength: 14, minSweepAtr: 0.12, maxCloseBeyondAtr: 0.04, minRejectionFrac: 0.42 },
    { lookback: 40, volLength: 50, relVolMin: 1.7, atrLength: 14, minSweepAtr: 0.08, maxCloseBeyondAtr: 0.03, minRejectionFrac: 0.38 },
    { lookback: 50, volLength: 50, relVolMin: 2.4, atrLength: 20, minSweepAtr: 0.12, maxCloseBeyondAtr: 0.05, minRejectionFrac: 0.45 },
  ],
});
