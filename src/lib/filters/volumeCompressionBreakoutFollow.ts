import {
  closeLocation,
  highestHigh,
  lowestLow,
  meanVolume,
} from "@alea/lib/filters/_barMath";
import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { z } from "zod";

/**
 * Volume-compression breakout follow. Requires both PRICE and VOLUME
 * to have been quiet in the run-up to the latest bar, then follows
 * the first decisive breakout with fresh volume.
 *
 *  - `compressionBars`: trailing bars (exclusive of latest) that
 *    must be in compression.
 *  - `rangeLookback`, `maxRangePercentile`: each compression bar's
 *    high–low range must be at or below the `maxRangePercentile`-th
 *    percentile of the rolling `rangeLookback` distribution.
 *  - `volLength`, `maxPreRelVolAvg`: average relative volume across
 *    the compression bars must be ≤ this ceiling.
 *  - `relVolMin`: latest bar's relative volume floor.
 *  - `minCloseLocation`: latest close must sit in the top fraction
 *    of its range for UP (or bottom fraction for DOWN).
 *
 * Signal:
 *  - Latest closes above the compression high with relVol surge
 *    and close near high → UP
 *  - Latest closes below the compression low with relVol surge
 *    and close near low → DOWN
 */
const configSchema = z.object({
  compressionBars: z.number().int().positive().default(8),
  rangeLookback: z.number().int().positive().default(50),
  maxRangePercentile: z.number().min(0).max(100).default(25),
  volLength: z.number().int().positive().default(20),
  maxPreRelVolAvg: z.number().positive().default(0.8),
  relVolMin: z.number().positive().default(1.6),
  minCloseLocation: z.number().min(0).max(1).default(0.75),
});
type Config = z.infer<typeof configSchema>;

function percentile({
  values,
  percent,
}: {
  readonly values: readonly number[];
  readonly percent: number;
}): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (percent / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) {
    return sorted[lo] ?? null;
  }
  const loVal = sorted[lo];
  const hiVal = sorted[hi];
  if (loVal === undefined || hiVal === undefined) {
    return null;
  }
  const t = rank - lo;
  return loVal + (hiVal - loVal) * t;
}

export const volumeCompressionBreakoutFollow: Filter<Config> = {
  id: "volume_compression_breakout_follow",
  version: 2,
  barSource: "coinbase",
  family: "volume_dormancy_expansion",
  description:
    "Compression breakout: tight ranges and dry volume across the trailing window, then a decisive breakout candle with strong relative volume and close near the bar's extreme. Up break → UP; down break → DOWN.",
  configSchema,
  requiredBars: (c) =>
    Math.max(c.compressionBars + 1, c.rangeLookback + 1, c.volLength + 1),
  predict: (config, bars) => {
    const n = bars.length;
    const latest = bars[n - 1];
    if (latest === undefined) {
      return null;
    }
    // Range distribution over rangeLookback bars ending BEFORE latest.
    const rangeStart = n - 1 - config.rangeLookback;
    if (rangeStart < 0) {
      return null;
    }
    const ranges: number[] = [];
    for (let i = rangeStart; i < n - 1; i += 1) {
      const bar = bars[i];
      if (bar === undefined) {
        return null;
      }
      ranges.push(bar.high - bar.low);
    }
    const rangeThreshold = percentile({
      values: ranges,
      percent: config.maxRangePercentile,
    });
    if (rangeThreshold === null) {
      return null;
    }
    // Compression bars: trailing `compressionBars` exclusive of latest.
    const compStart = n - 1 - config.compressionBars;
    if (compStart < 0) {
      return null;
    }
    let relVolSum = 0;
    let rangeSum = 0;
    let count = 0;
    for (let i = compStart; i < n - 1; i += 1) {
      const bar = bars[i];
      if (bar === undefined) {
        return null;
      }
      const avgVol = meanVolume({
        bars,
        start: i - config.volLength,
        endExclusive: i,
      });
      if (avgVol === null || avgVol <= 0) {
        return null;
      }
      relVolSum += bar.volume / avgVol;
      rangeSum += bar.high - bar.low;
      count += 1;
    }
    if (count === 0) {
      return null;
    }
    // Compression window's mean bar range must sit in the bottom
    // `maxRangePercentile` of the rolling distribution. Mean is the
    // operative measure — requiring EVERY bar in the window to be
    // below that quantile makes the filter unusably sparse for the
    // typical config ranges.
    if (rangeSum / count > rangeThreshold) {
      return null;
    }
    if (relVolSum / count > config.maxPreRelVolAvg) {
      return null;
    }
    // Latest bar gates.
    const latestAvg = meanVolume({
      bars,
      start: n - 1 - config.volLength,
      endExclusive: n - 1,
    });
    if (latestAvg === null || latestAvg <= 0) {
      return null;
    }
    if (latest.volume / latestAvg < config.relVolMin) {
      return null;
    }
    const compHigh = highestHigh({
      bars,
      start: compStart,
      endExclusive: n - 1,
    });
    const compLow = lowestLow({
      bars,
      start: compStart,
      endExclusive: n - 1,
    });
    if (compHigh === null || compLow === null) {
      return null;
    }
    const cl = closeLocation(latest);
    if (cl === null) {
      return null;
    }
    if (latest.close > compHigh && cl >= config.minCloseLocation) {
      return "up";
    }
    if (latest.close < compLow && 1 - cl >= config.minCloseLocation) {
      return "down";
    }
    return null;
  },
};

registerFilter({
  filter: volumeCompressionBreakoutFollow as Filter<unknown>,
  defaultConfigs: () => [
    { compressionBars: 8, rangeLookback: 50, maxRangePercentile: 25, volLength: 20, maxPreRelVolAvg: 0.8, relVolMin: 1.6, minCloseLocation: 0.75 },
    { compressionBars: 10, rangeLookback: 100, maxRangePercentile: 20, volLength: 20, maxPreRelVolAvg: 0.7, relVolMin: 2.0, minCloseLocation: 0.8 },
    { compressionBars: 6, rangeLookback: 50, maxRangePercentile: 30, volLength: 20, maxPreRelVolAvg: 0.85, relVolMin: 1.8, minCloseLocation: 0.75 },
    { compressionBars: 12, rangeLookback: 100, maxRangePercentile: 25, volLength: 50, maxPreRelVolAvg: 0.75, relVolMin: 1.7, minCloseLocation: 0.7 },
    { compressionBars: 15, rangeLookback: 150, maxRangePercentile: 20, volLength: 50, maxPreRelVolAvg: 0.65, relVolMin: 2.2, minCloseLocation: 0.8 },
  ],
});
