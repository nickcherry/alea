import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeObvSeries } from "@alea/lib/indicators/obv";
import { z } from "zod";

const configSchema = z.object({
  lookback: z.number().int().positive().default(14),
  minPriceBreakPct: z.number().nonnegative().default(0.0005),
  minObvDivergenceFrac: z.number().nonnegative().default(0.1),
});
type Config = z.infer<typeof configSchema>;

export const obvDivergenceReversal: Filter<Config> = {
  id: "obv_divergence_reversal",
  version: 1,
  barSource: "coinbase",
  family: "volume_divergence",
  description:
    "OBV/price divergence reversal. A price break to a new local high without OBV confirmation predicts DOWN; a new local low without OBV confirmation predicts UP.",
  configSchema,
  requiredBars: (c) => c.lookback + 1,
  predict: (config, bars) => {
    const n = bars.length;
    const latest = bars[n - 1];
    if (latest === undefined) {
      return null;
    }
    const closes = bars.map((b) => b.close);
    const volumes = bars.map((b) => b.volume);
    const obv = computeObvSeries({ closes, volumes });
    let priorHigh = -Infinity;
    let priorLow = Infinity;
    let priorObvHigh = -Infinity;
    let priorObvLow = Infinity;
    for (let i = n - 1 - config.lookback; i <= n - 2; i += 1) {
      const bar = bars[i];
      const value = obv[i];
      if (bar === undefined || value === undefined) {
        return null;
      }
      priorHigh = Math.max(priorHigh, bar.high);
      priorLow = Math.min(priorLow, bar.low);
      priorObvHigh = Math.max(priorObvHigh, value);
      priorObvLow = Math.min(priorObvLow, value);
    }
    if (!Number.isFinite(priorHigh) || !Number.isFinite(priorLow)) {
      return null;
    }
    const latestObv = obv[n - 1];
    if (latestObv === undefined) {
      return null;
    }
    const obvScale = Math.max(
      priorObvHigh - priorObvLow,
      Math.abs(priorObvHigh),
      Math.abs(priorObvLow),
      1,
    );
    const minObvGap = config.minObvDivergenceFrac * obvScale;
    if (
      priorHigh > 0 &&
      (latest.high - priorHigh) / priorHigh >= config.minPriceBreakPct &&
      priorObvHigh - latestObv >= minObvGap
    ) {
      return "down";
    }
    if (
      priorLow > 0 &&
      (priorLow - latest.low) / priorLow >= config.minPriceBreakPct &&
      latestObv - priorObvLow >= minObvGap
    ) {
      return "up";
    }
    return null;
  },
};

registerFilter({
  filter: obvDivergenceReversal as Filter<unknown>,
  defaultConfigs: () => [
    { lookback: 14, minPriceBreakPct: 0.0005, minObvDivergenceFrac: 0.1 },
    { lookback: 20, minPriceBreakPct: 0.001, minObvDivergenceFrac: 0.1 },
    { lookback: 20, minPriceBreakPct: 0.002, minObvDivergenceFrac: 0.15 },
    { lookback: 50, minPriceBreakPct: 0.001, minObvDivergenceFrac: 0.1 },
    { lookback: 30, minPriceBreakPct: 0.0015, minObvDivergenceFrac: 0.2 },
  ],
});

