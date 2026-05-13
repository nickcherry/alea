import { bodySize, meanVolume } from "@alea/lib/filters/_barMath";
import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeAtrSeries } from "@alea/lib/indicators/atr";
import { computeRollingVwapZSeries } from "@alea/lib/indicators/vwap";
import { z } from "zod";

/**
 * Rolling-VWAP cross follow. Prior close sat on one side of the
 * rolling VWAP; the latest close has crossed to the other side
 * with a strong body, fresh participation, and minimum
 * `minCloseDistanceAtr` ATRs of separation from the new VWAP.
 *
 * Signal:
 *  - Cross from below to above → UP
 *  - Cross from above to below → DOWN
 */
const configSchema = z.object({
  vwapLength: z.number().int().positive().default(20),
  volLength: z.number().int().positive().default(20),
  relVolMin: z.number().positive().default(1.3),
  atrLength: z.number().int().positive().default(14),
  minBodyAtr: z.number().nonnegative().default(0.3),
  minCloseDistanceAtr: z.number().nonnegative().default(0.05),
});
type Config = z.infer<typeof configSchema>;

export const rollingVwapCrossFollow: Filter<Config> = {
  id: "rolling_vwap_cross_follow",
  version: 1,
  barSource: "coinbase",
  family: "volume_weighted_acceptance",
  description:
    "Follows a decisive cross of the rolling VWAP. Strong body, high relative volume, and the latest close at least `minCloseDistanceAtr` ATRs past VWAP on the new side.",
  configSchema,
  requiredBars: (c) =>
    Math.max(c.vwapLength + 1, c.volLength + 1, c.atrLength + 2),
  predict: (config, bars) => {
    const n = bars.length;
    const latest = bars[n - 1];
    const prior = bars[n - 2];
    if (latest === undefined || prior === undefined) {
      return null;
    }
    const closes = bars.map((b) => b.close);
    const volumes = bars.map((b) => b.volume);
    const { vwap } = computeRollingVwapZSeries({
      closes,
      volumes,
      period: config.vwapLength,
    });
    const latestVwap = vwap[n - 1];
    const priorVwap = vwap[n - 2];
    if (
      latestVwap === null ||
      latestVwap === undefined ||
      priorVwap === null ||
      priorVwap === undefined
    ) {
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
    if (bodySize(latest) < config.minBodyAtr * atr) {
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
    const minDist = config.minCloseDistanceAtr * atr;
    if (
      prior.close < priorVwap &&
      latest.close - latestVwap >= minDist
    ) {
      return "up";
    }
    if (
      prior.close > priorVwap &&
      latestVwap - latest.close >= minDist
    ) {
      return "down";
    }
    return null;
  },
};

registerFilter({
  filter: rollingVwapCrossFollow as Filter<unknown>,
  defaultConfigs: () => [
    { vwapLength: 20, volLength: 20, relVolMin: 1.3, atrLength: 14, minBodyAtr: 0.3, minCloseDistanceAtr: 0.05 },
    { vwapLength: 20, volLength: 20, relVolMin: 1.8, atrLength: 14, minBodyAtr: 0.5, minCloseDistanceAtr: 0.1 },
    { vwapLength: 50, volLength: 50, relVolMin: 1.5, atrLength: 14, minBodyAtr: 0.4, minCloseDistanceAtr: 0.1 },
    { vwapLength: 14, volLength: 20, relVolMin: 2.0, atrLength: 7, minBodyAtr: 0.4, minCloseDistanceAtr: 0.05 },
    { vwapLength: 30, volLength: 50, relVolMin: 1.6, atrLength: 20, minBodyAtr: 0.6, minCloseDistanceAtr: 0.15 },
  ],
});
