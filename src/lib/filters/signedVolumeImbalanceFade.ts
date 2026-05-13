import { meanVolume } from "@alea/lib/filters/_barMath";
import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeAtrSeries } from "@alea/lib/indicators/atr";
import { z } from "zod";

/**
 * Signed-volume imbalance fade. Sums volume on green vs red candles
 * across the lookback. If one side dominates beyond `imbalanceRatio`
 * of total volume AND the net price move clears `minNetMoveAtr` in
 * that same direction AND average participation clears
 * `minAvgRelVol`, fade the move.
 *
 * Signal:
 *  - Positive imbalance + net up → DOWN
 *  - Negative imbalance + net down → UP
 */
const configSchema = z.object({
  lookback: z.number().int().positive().default(5),
  volLength: z.number().int().positive().default(20),
  atrLength: z.number().int().positive().default(14),
  imbalanceRatio: z.number().min(0).max(1).default(0.8),
  minNetMoveAtr: z.number().nonnegative().default(0.8),
  minAvgRelVol: z.number().positive().default(1.2),
});
type Config = z.infer<typeof configSchema>;

export const signedVolumeImbalanceFade: Filter<Config> = {
  id: "signed_volume_imbalance_fade",
  version: 1,
  barSource: "coinbase",
  family: "signed_flow_exhaustion",
  description:
    "Fades extreme signed-volume imbalance after an extended move. Body-direction is used as a crude buy/sell proxy; dominant side > imbalanceRatio plus net move in the same direction triggers a fade.",
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
    let posVol = 0;
    let negVol = 0;
    let relVolSum = 0;
    for (let i = startIdx; i <= n - 1; i += 1) {
      const bar = bars[i];
      if (bar === undefined) {
        return null;
      }
      if (bar.close > bar.open) {
        posVol += bar.volume;
      } else if (bar.close < bar.open) {
        negVol += bar.volume;
      }
      const avg = meanVolume({
        bars,
        start: i - config.volLength,
        endExclusive: i,
      });
      if (avg === null || avg <= 0) {
        return null;
      }
      relVolSum += bar.volume / avg;
    }
    const totalVol = posVol + negVol;
    if (totalVol <= 0) {
      return null;
    }
    const avgRelVol = relVolSum / config.lookback;
    if (avgRelVol < config.minAvgRelVol) {
      return null;
    }
    const posFrac = posVol / totalVol;
    const negFrac = negVol / totalVol;
    const firstClose = bars[startIdx - 1]?.close;
    if (firstClose === undefined) {
      return null;
    }
    const netMove = latest.close - firstClose;
    const minMove = config.minNetMoveAtr * atr;
    if (posFrac >= config.imbalanceRatio && netMove >= minMove) {
      return "down";
    }
    if (negFrac >= config.imbalanceRatio && -netMove >= minMove) {
      return "up";
    }
    return null;
  },
};

registerFilter({
  filter: signedVolumeImbalanceFade as Filter<unknown>,
  defaultConfigs: () => [
    { lookback: 5, volLength: 20, atrLength: 14, imbalanceRatio: 0.8, minNetMoveAtr: 0.8, minAvgRelVol: 1.2 },
    { lookback: 8, volLength: 20, atrLength: 14, imbalanceRatio: 0.75, minNetMoveAtr: 1.2, minAvgRelVol: 1.1 },
    { lookback: 10, volLength: 50, atrLength: 14, imbalanceRatio: 0.7, minNetMoveAtr: 1.5, minAvgRelVol: 1.0 },
    { lookback: 4, volLength: 20, atrLength: 7, imbalanceRatio: 0.9, minNetMoveAtr: 0.6, minAvgRelVol: 1.5 },
    { lookback: 12, volLength: 50, atrLength: 20, imbalanceRatio: 0.72, minNetMoveAtr: 2.0, minAvgRelVol: 1.0 },
  ],
});
