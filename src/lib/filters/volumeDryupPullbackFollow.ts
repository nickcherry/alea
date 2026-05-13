import {
  bodyDirection,
  closeLocation,
  meanVolume,
} from "@alea/lib/filters/_barMath";
import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeEmaSeries } from "@alea/lib/indicators/ema";
import { z } from "zod";

/**
 * Volume-dry-up pullback then resume. Trend continuation setup: an
 * impulse establishes the trend, a counter-trend pullback prints on
 * declining volume, and a resume candle in the trend direction
 * arrives on stronger volume.
 *
 * Signal:
 *  - Uptrend (EMA slope up) + last `pullbackBars` low-volume pullback
 *    + bullish resume candle → UP
 *  - Downtrend + low-volume pullback + bearish resume candle → DOWN
 *
 * Knobs:
 *  - `emaLength`, `slopeLookback`: EMA and how far back to measure
 *    its slope to classify trend direction.
 *  - `atrLength`: only used as a place-holder for warm-up sizing.
 *  - `pullbackBars`: number of preceding bars that must look like
 *    a pullback — body direction OPPOSITE the trend and weak volume.
 *  - `maxPullbackRelVol`: pullback bars' relative volume ceiling.
 *  - `minResumeRelVol`: resume bar's relative-volume floor.
 *  - `minResumeCloseLocation`: resume bar's close must sit in the
 *    top fraction of its range (or bottom for downtrends).
 */
const configSchema = z.object({
  emaLength: z.number().int().positive().default(20),
  slopeLookback: z.number().int().positive().default(5),
  atrLength: z.number().int().positive().default(14),
  pullbackBars: z.number().int().positive().default(2),
  maxPullbackRelVol: z.number().positive().default(0.8),
  minResumeRelVol: z.number().positive().default(1.0),
  minResumeCloseLocation: z.number().min(0).max(1).default(0.65),
});
type Config = z.infer<typeof configSchema>;

export const volumeDryupPullbackFollow: Filter<Config> = {
  id: "volume_dryup_pullback_follow",
  version: 1,
  barSource: "coinbase",
  family: "trend_pullback_continuation",
  description:
    "Trend-pullback continuation that demands volume dry-up during the pullback and stronger volume on the resume candle. Up-trend pullback + bullish resume → UP; down-trend pullback + bearish resume → DOWN.",
  configSchema,
  requiredBars: (c) =>
    Math.max(
      c.emaLength + c.slopeLookback,
      c.atrLength + 2,
      c.pullbackBars + 2,
    ),
  predict: (config, bars) => {
    const n = bars.length;
    const latest = bars[n - 1];
    if (latest === undefined) {
      return null;
    }
    const closes = bars.map((b) => b.close);
    const ema = computeEmaSeries({ closes, period: config.emaLength });
    const emaNow = ema[n - 1];
    const emaThen = ema[n - 1 - config.slopeLookback];
    if (emaNow === null || emaNow === undefined || emaThen === null || emaThen === undefined) {
      return null;
    }
    const trend: "up" | "down" | null =
      emaNow > emaThen ? "up" : emaNow < emaThen ? "down" : null;
    if (trend === null) {
      return null;
    }
    // Volume gates need an averaging window large enough for relVol.
    const avgVolumeWindow = Math.min(20, n - 1 - config.pullbackBars);
    if (avgVolumeWindow < 5) {
      return null;
    }
    const avgVolume = meanVolume({
      bars,
      start: n - 1 - avgVolumeWindow,
      endExclusive: n - 1,
    });
    if (avgVolume === null || avgVolume <= 0) {
      return null;
    }
    // Pullback bars precede the latest "resume" bar. They must be
    // counter-trend (red in an uptrend, green in a downtrend) AND
    // have relative volume below `maxPullbackRelVol`.
    for (let k = 1; k <= config.pullbackBars; k += 1) {
      const idx = n - 1 - k;
      const bar = bars[idx];
      if (bar === undefined) {
        return null;
      }
      const dir = bodyDirection(bar);
      if (dir === null || dir === trend) {
        return null;
      }
      if (bar.volume / avgVolume > config.maxPullbackRelVol) {
        return null;
      }
    }
    if (latest.volume / avgVolume < config.minResumeRelVol) {
      return null;
    }
    const latestDir = bodyDirection(latest);
    if (latestDir !== trend) {
      return null;
    }
    const cl = closeLocation(latest);
    if (cl === null) {
      return null;
    }
    if (trend === "up" && cl < config.minResumeCloseLocation) {
      return null;
    }
    if (trend === "down" && 1 - cl < config.minResumeCloseLocation) {
      return null;
    }
    return trend;
  },
};

registerFilter({
  filter: volumeDryupPullbackFollow as Filter<unknown>,
  defaultConfigs: () => [
    {
      emaLength: 20,
      slopeLookback: 5,
      atrLength: 14,
      pullbackBars: 2,
      maxPullbackRelVol: 0.8,
      minResumeRelVol: 1.0,
      minResumeCloseLocation: 0.65,
    },
    {
      emaLength: 20,
      slopeLookback: 8,
      atrLength: 14,
      pullbackBars: 3,
      maxPullbackRelVol: 0.7,
      minResumeRelVol: 1.2,
      minResumeCloseLocation: 0.7,
    },
    {
      emaLength: 50,
      slopeLookback: 10,
      atrLength: 14,
      pullbackBars: 3,
      maxPullbackRelVol: 0.75,
      minResumeRelVol: 1.0,
      minResumeCloseLocation: 0.65,
    },
    {
      emaLength: 14,
      slopeLookback: 5,
      atrLength: 7,
      pullbackBars: 2,
      maxPullbackRelVol: 0.85,
      minResumeRelVol: 1.3,
      minResumeCloseLocation: 0.7,
    },
    {
      emaLength: 34,
      slopeLookback: 8,
      atrLength: 20,
      pullbackBars: 4,
      maxPullbackRelVol: 0.7,
      minResumeRelVol: 1.1,
      minResumeCloseLocation: 0.65,
    },
  ],
});
