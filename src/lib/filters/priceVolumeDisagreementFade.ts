import { meanVolume } from "@alea/lib/filters/_barMath";
import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeAtrSeries } from "@alea/lib/indicators/atr";
import { z } from "zod";

/**
 * Price–volume disagreement fade. Net price moved in one direction
 * over the lookback, but volume on candles of the OPPOSITE color
 * accounts for ≥ `minOppSignedVolRatio` of total participation.
 * That's distribution/accumulation behavior — the side that's
 * actually trading isn't the side the price tape suggests.
 *
 * Signal:
 *  - Net up + heavy red-body share → DOWN
 *  - Net down + heavy green-body share → UP
 */
const configSchema = z.object({
  lookback: z.number().int().positive().default(5),
  volLength: z.number().int().positive().default(20),
  atrLength: z.number().int().positive().default(14),
  minNetMoveAtr: z.number().nonnegative().default(0.4),
  minOppSignedVolRatio: z.number().min(0).max(1).default(0.6),
  minAvgRelVol: z.number().positive().default(1.0),
});
type Config = z.infer<typeof configSchema>;

export const priceVolumeDisagreementFade: Filter<Config> = {
  id: "price_volume_disagreement_fade",
  version: 1,
  barSource: "coinbase",
  family: "signed_flow_divergence",
  description:
    "Fades a directional price move that the volume tape disagrees with. Net up + heavy red-body share → DOWN; net down + heavy green-body share → UP.",
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
    const firstClose = bars[startIdx - 1]?.close;
    if (firstClose === undefined) {
      return null;
    }
    const netMove = latest.close - firstClose;
    const minMove = config.minNetMoveAtr * atr;
    if (netMove >= minMove) {
      const oppFrac = negVol / totalVol;
      if (oppFrac >= config.minOppSignedVolRatio) {
        return "down";
      }
    }
    if (-netMove >= minMove) {
      const oppFrac = posVol / totalVol;
      if (oppFrac >= config.minOppSignedVolRatio) {
        return "up";
      }
    }
    return null;
  },
};

registerFilter({
  filter: priceVolumeDisagreementFade as Filter<unknown>,
  defaultConfigs: () => [
    { lookback: 5, volLength: 20, atrLength: 14, minNetMoveAtr: 0.4, minOppSignedVolRatio: 0.6, minAvgRelVol: 1.0 },
    { lookback: 8, volLength: 20, atrLength: 14, minNetMoveAtr: 0.7, minOppSignedVolRatio: 0.58, minAvgRelVol: 1.0 },
    { lookback: 10, volLength: 50, atrLength: 14, minNetMoveAtr: 1.0, minOppSignedVolRatio: 0.55, minAvgRelVol: 0.9 },
    { lookback: 4, volLength: 20, atrLength: 7, minNetMoveAtr: 0.3, minOppSignedVolRatio: 0.65, minAvgRelVol: 1.2 },
    { lookback: 12, volLength: 50, atrLength: 20, minNetMoveAtr: 1.2, minOppSignedVolRatio: 0.55, minAvgRelVol: 0.9 },
  ],
});
