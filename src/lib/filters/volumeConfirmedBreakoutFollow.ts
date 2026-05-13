import {
  closeLocation,
  highestHigh,
  lowestLow,
  meanVolume,
} from "@alea/lib/filters/_barMath";
import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeAtrSeries } from "@alea/lib/indicators/atr";
import { z } from "zod";

/**
 * Volume-confirmed breakout follow. Opposite hypothesis to
 * low_volume_breakout_fade: a breakout that LEAVES a recent range
 * with strong relative volume AND closes near the bar's extreme is
 * a real impulse worth following.
 *
 * Signal:
 *  - Break above prior `lookback` high + high relative volume +
 *    close near high → UP
 *  - Break below prior `lookback` low + high relative volume +
 *    close near low → DOWN
 */
const configSchema = z.object({
  lookback: z.number().int().positive().default(20),
  volLength: z.number().int().positive().default(20),
  relVolMin: z.number().positive().default(1.5),
  atrLength: z.number().int().positive().default(14),
  minBreakAtr: z.number().nonnegative().default(0.05),
  minCloseLocation: z.number().min(0).max(1).default(0.75),
});
type Config = z.infer<typeof configSchema>;

export const volumeConfirmedBreakoutFollow: Filter<Config> = {
  id: "volume_confirmed_breakout_follow",
  version: 1,
  barSource: "coinbase",
  family: "participation_continuation",
  description:
    "Volume-confirmed breakout follow. A close beyond the prior `lookback` extreme on high relative volume with close near the bar's extreme predicts continuation in the breakout direction.",
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
    const cl = closeLocation(latest);
    if (cl === null) {
      return null;
    }
    const minBreak = config.minBreakAtr * atr;
    if (latest.close - priorHigh >= minBreak && cl >= config.minCloseLocation) {
      return "up";
    }
    if (priorLow - latest.close >= minBreak && 1 - cl >= config.minCloseLocation) {
      return "down";
    }
    return null;
  },
};

registerFilter({
  filter: volumeConfirmedBreakoutFollow as Filter<unknown>,
  defaultConfigs: () => [
    {
      lookback: 20,
      volLength: 20,
      relVolMin: 1.5,
      atrLength: 14,
      minBreakAtr: 0.05,
      minCloseLocation: 0.75,
    },
    {
      lookback: 20,
      volLength: 20,
      relVolMin: 2.0,
      atrLength: 14,
      minBreakAtr: 0.1,
      minCloseLocation: 0.8,
    },
    {
      lookback: 50,
      volLength: 50,
      relVolMin: 1.5,
      atrLength: 14,
      minBreakAtr: 0.1,
      minCloseLocation: 0.75,
    },
    {
      lookback: 14,
      volLength: 20,
      relVolMin: 1.8,
      atrLength: 7,
      minBreakAtr: 0.05,
      minCloseLocation: 0.8,
    },
    {
      lookback: 30,
      volLength: 50,
      relVolMin: 2.2,
      atrLength: 20,
      minBreakAtr: 0.15,
      minCloseLocation: 0.7,
    },
  ],
});
