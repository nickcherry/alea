import { bodyDirection, meanVolume } from "@alea/lib/filters/_barMath";
import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeAtrSeries } from "@alea/lib/indicators/atr";
import { z } from "zod";

/**
 * Follows accelerating participation. Over the trailing `lookback`
 * bars, relative volume must rise (per-bar slope clears
 * `minVolSlope`), the latest relVol must clear `minRelVolEnd`, the
 * dominant body direction must own at least `minDirectionalRatio`
 * of the bars, and the net close-to-close move must clear
 * `minNetMoveAtr` ATRs in that dominant direction.
 *
 * `minVolSlope` is expressed in relVol units per bar: with
 * `lookback=3, minVolSlope=0.15`, relVol must rise by 0.45 across
 * the window.
 *
 * Signal:
 *  - Dominant up + rising volume + net up move → UP
 *  - Dominant down + rising volume + net down move → DOWN
 */
const configSchema = z.object({
  lookback: z.number().int().positive().default(3),
  volLength: z.number().int().positive().default(20),
  minRelVolEnd: z.number().positive().default(1.3),
  minVolSlope: z.number().default(0.15),
  minDirectionalRatio: z.number().min(0).max(1).default(0.67),
  atrLength: z.number().int().positive().default(14),
  minNetMoveAtr: z.number().nonnegative().default(0.5),
});
type Config = z.infer<typeof configSchema>;

export const volumeGradientTrendFollow: Filter<Config> = {
  id: "volume_gradient_trend_follow",
  version: 1,
  barSource: "coinbase",
  family: "volume_acceleration_continuation",
  description:
    "Follows accelerating participation: rising relative volume across the trailing window, directional body dominance, and a net close-to-close move clearing an ATR floor.",
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
    // Relative-volume series over the lookback.
    const relVols: number[] = [];
    let upBars = 0;
    let downBars = 0;
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
      relVols.push(bar.volume / avg);
      const dir = bodyDirection(bar);
      if (dir === "up") {
        upBars += 1;
      } else if (dir === "down") {
        downBars += 1;
      }
    }
    const endRelVol = relVols[relVols.length - 1];
    const startRelVol = relVols[0];
    if (endRelVol === undefined || startRelVol === undefined) {
      return null;
    }
    if (endRelVol < config.minRelVolEnd) {
      return null;
    }
    const slope = (endRelVol - startRelVol) / config.lookback;
    if (slope < config.minVolSlope) {
      return null;
    }
    const total = upBars + downBars;
    if (total === 0) {
      return null;
    }
    const upRatio = upBars / config.lookback;
    const downRatio = downBars / config.lookback;
    const firstClose = bars[startIdx - 1]?.close;
    if (firstClose === undefined) {
      return null;
    }
    const netMove = latest.close - firstClose;
    const minMove = config.minNetMoveAtr * atr;
    if (
      netMove >= minMove &&
      upRatio >= config.minDirectionalRatio &&
      upBars >= downBars
    ) {
      return "up";
    }
    if (
      -netMove >= minMove &&
      downRatio >= config.minDirectionalRatio &&
      downBars >= upBars
    ) {
      return "down";
    }
    return null;
  },
};

registerFilter({
  filter: volumeGradientTrendFollow as Filter<unknown>,
  defaultConfigs: () => [
    { lookback: 3, volLength: 20, minRelVolEnd: 1.3, minVolSlope: 0.15, minDirectionalRatio: 0.67, atrLength: 14, minNetMoveAtr: 0.5 },
    { lookback: 4, volLength: 20, minRelVolEnd: 1.5, minVolSlope: 0.12, minDirectionalRatio: 0.75, atrLength: 14, minNetMoveAtr: 0.7 },
    { lookback: 5, volLength: 50, minRelVolEnd: 1.4, minVolSlope: 0.10, minDirectionalRatio: 0.6, atrLength: 14, minNetMoveAtr: 1.0 },
    { lookback: 3, volLength: 20, minRelVolEnd: 2.0, minVolSlope: 0.20, minDirectionalRatio: 1.0, atrLength: 7, minNetMoveAtr: 0.6 },
    { lookback: 6, volLength: 50, minRelVolEnd: 1.6, minVolSlope: 0.08, minDirectionalRatio: 0.67, atrLength: 20, minNetMoveAtr: 1.2 },
  ],
});
