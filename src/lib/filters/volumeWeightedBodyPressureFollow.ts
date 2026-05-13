import { meanVolume } from "@alea/lib/filters/_barMath";
import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeAtrSeries } from "@alea/lib/indicators/atr";
import { z } from "zod";

/**
 * Volume-weighted body-pressure follow. Each candle in the lookback
 * contributes `sign(body) * relVol * |body|/ATR` to a running
 * pressure. The sum measures persistent one-sided flow weighted by
 * participation. We also require that the share of bars contributing
 * in the dominant direction clears `minDirectionalRatio` so a single
 * giant candle doesn't carry the signal alone.
 *
 * Signal:
 *  - Positive pressure ≥ `pressureThreshold` + dominant-direction
 *    ratio clears the floor → UP
 *  - Negative pressure ≤ -`pressureThreshold` + ratio clears the
 *    floor → DOWN
 */
const configSchema = z.object({
  lookback: z.number().int().positive().default(5),
  volLength: z.number().int().positive().default(20),
  atrLength: z.number().int().positive().default(14),
  pressureThreshold: z.number().nonnegative().default(2.0),
  minDirectionalRatio: z.number().min(0).max(1).default(0.65),
});
type Config = z.infer<typeof configSchema>;

export const volumeWeightedBodyPressureFollow: Filter<Config> = {
  id: "volume_weighted_body_pressure_follow",
  version: 1,
  barSource: "coinbase",
  family: "volume_flow_continuation",
  description:
    "Follows persistent volume-weighted body pressure. Sums sign(body)*relVol*|body|/ATR over the lookback; if the magnitude clears the threshold and the dominant-direction bar ratio clears its floor, predict in the dominant direction.",
  configSchema,
  requiredBars: (c) =>
    Math.max(c.lookback + c.volLength, c.atrLength + 2),
  predict: (config, bars) => {
    const n = bars.length;
    const highs = bars.map((b) => b.high);
    const lows = bars.map((b) => b.low);
    const closes = bars.map((b) => b.close);
    const atr = computeAtrSeries({
      highs,
      lows,
      closes,
      period: config.atrLength,
    })[n - 1];
    if (atr === null || atr === undefined || atr <= 0) {
      return null;
    }
    let pressure = 0;
    let upBars = 0;
    let downBars = 0;
    for (let k = 0; k < config.lookback; k += 1) {
      const idx = n - 1 - k;
      const bar = bars[idx];
      if (bar === undefined) {
        return null;
      }
      const avgVol = meanVolume({
        bars,
        start: idx - config.volLength,
        endExclusive: idx,
      });
      if (avgVol === null || avgVol <= 0) {
        return null;
      }
      const relVol = bar.volume / avgVol;
      const body = bar.close - bar.open;
      const contribution = (body / atr) * relVol;
      pressure += contribution;
      if (body > 0) {
        upBars += 1;
      } else if (body < 0) {
        downBars += 1;
      }
    }
    const total = upBars + downBars;
    if (total === 0) {
      return null;
    }
    const directionalRatio =
      pressure >= 0 ? upBars / total : downBars / total;
    if (directionalRatio < config.minDirectionalRatio) {
      return null;
    }
    if (pressure >= config.pressureThreshold) {
      return "up";
    }
    if (pressure <= -config.pressureThreshold) {
      return "down";
    }
    return null;
  },
};

registerFilter({
  filter: volumeWeightedBodyPressureFollow as Filter<unknown>,
  defaultConfigs: () => [
    { lookback: 5, volLength: 20, atrLength: 14, pressureThreshold: 2.0, minDirectionalRatio: 0.65 },
    { lookback: 8, volLength: 20, atrLength: 14, pressureThreshold: 2.5, minDirectionalRatio: 0.65 },
    { lookback: 10, volLength: 50, atrLength: 14, pressureThreshold: 3.0, minDirectionalRatio: 0.6 },
    { lookback: 5, volLength: 20, atrLength: 7, pressureThreshold: 2.2, minDirectionalRatio: 0.7 },
    { lookback: 14, volLength: 50, atrLength: 20, pressureThreshold: 3.5, minDirectionalRatio: 0.6 },
  ],
});
