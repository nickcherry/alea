import { bodyFraction, percentileRank } from "@alea/lib/filters/_barMath";
import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeBollingerSeries } from "@alea/lib/indicators/bollinger";
import { z } from "zod";

const configSchema = z.object({
  length: z.number().int().positive().default(20),
  multiplier: z.number().positive().default(2),
  widthLookback: z.number().int().positive().default(100),
  maxWidthPercentile: z.number().min(0).max(100).default(10),
  minBodyFraction: z.number().min(0).max(1).default(0.5),
});
type Config = z.infer<typeof configSchema>;

export const squeezeBreakoutFollow: Filter<Config> = {
  id: "squeeze_breakout_follow",
  version: 1,
  family: "volatility_compression_continuation",
  description:
    "Follows Bollinger squeeze breakouts. The prior bandwidth must sit in a low percentile, then the latest real-body candle must close outside the corresponding band.",
  configSchema,
  requiredBars: (c) => c.length + c.widthLookback + 1,
  predict: (config, bars) => {
    const closes = bars.map((b) => b.close);
    const { middle, upper, lower } = computeBollingerSeries({
      closes,
      period: config.length,
      multiplier: config.multiplier,
    });
    const widths: number[] = [];
    const priorIndex = bars.length - 2;
    for (
      let i = priorIndex - config.widthLookback + 1;
      i <= priorIndex;
      i += 1
    ) {
      const mid = middle[i];
      const up = upper[i];
      const lo = lower[i];
      if (
        mid === null ||
        mid === undefined ||
        up === null ||
        up === undefined ||
        lo === null ||
        lo === undefined ||
        mid === 0
      ) {
        return null;
      }
      widths.push((up - lo) / Math.abs(mid));
    }
    const priorWidth = widths[widths.length - 1];
    if (priorWidth === undefined) {
      return null;
    }
    const rank = percentileRank({ values: widths, value: priorWidth });
    const latest = bars[bars.length - 1];
    const latestClose = closes[closes.length - 1];
    const latestUpper = upper[upper.length - 1];
    const latestLower = lower[lower.length - 1];
    const body = latest === undefined ? null : bodyFraction(latest);
    if (
      rank === null ||
      rank > config.maxWidthPercentile ||
      latestClose === undefined ||
      latestUpper === null ||
      latestUpper === undefined ||
      latestLower === null ||
      latestLower === undefined ||
      body === null ||
      body < config.minBodyFraction
    ) {
      return null;
    }
    if (latestClose > latestUpper) {
      return "up";
    }
    if (latestClose < latestLower) {
      return "down";
    }
    return null;
  },
};

registerFilter({
  filter: squeezeBreakoutFollow as Filter<unknown>,
  defaultConfigs: () => [
    // Survived the 2026-05-11 prune as the selected 5m/high_vol_trending config.
    {
      length: 20,
      multiplier: 2,
      widthLookback: 100,
      maxWidthPercentile: 10,
      minBodyFraction: 0.5,
    },
  ],
});
