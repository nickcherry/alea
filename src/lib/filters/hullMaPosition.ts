import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { z } from "zod";

/**
 * Position vs. a Hull Moving Average. Hull MA reduces lag relative
 * to SMA / EMA by combining two WMAs at different periods and
 * passing the result through a final WMA:
 *
 *   HMA(p) = WMA( 2·WMA(close, p/2) - WMA(close, p), sqrt(p) )
 *
 * Engages reversion when the close pulls away from HMA by `threshold`
 * (fraction of HMA value).
 */
function wma(values: readonly number[], period: number): number | null {
  if (values.length < period) {
    return null;
  }
  let weightedSum = 0;
  let weightSum = 0;
  for (let k = 0; k < period; k += 1) {
    const w = k + 1;
    const v = values[values.length - period + k];
    if (v === undefined) {
      return null;
    }
    weightedSum += v * w;
    weightSum += w;
  }
  return weightedSum / weightSum;
}

const configSchema = z.object({
  period: z.number().int().positive().default(20),
  threshold: z.number().min(0).default(0.005),
});
type Config = z.infer<typeof configSchema>;

export const hullMaPosition: Filter<Config> = {
  id: "hull_ma_position",
  version: 1,
  family: "ma_position",
  description:
    "Mean reversion against a Hull Moving Average. Hull MA reduces lag vs. SMA/EMA via stacked WMAs; tests whether the less-laggy baseline gives a cleaner reversion signal.",
  configSchema,
  requiredBars: (c) => c.period * 2 + 1,
  predict: (config, bars) => {
    const closes = bars.map((b) => b.close);
    const p = config.period;
    const half = Math.max(1, Math.floor(p / 2));
    const w1 = wma(closes, half);
    const w2 = wma(closes, p);
    if (w1 === null || w2 === null) {
      return null;
    }
    // Build the diff series 2·WMA(p/2) - WMA(p), but we only need
    // its trailing sqrt(p) values for the final WMA. Construct
    // those by sliding the half/full WMAs back through the series.
    const sqp = Math.max(1, Math.round(Math.sqrt(p)));
    const diff: number[] = [];
    for (let i = p - 1; i < closes.length; i += 1) {
      const slice = closes.slice(0, i + 1);
      const wh = wma(slice, half);
      const wp = wma(slice, p);
      if (wh === null || wp === null) {
        continue;
      }
      diff.push(2 * wh - wp);
    }
    if (diff.length < sqp) {
      return null;
    }
    const hma = wma(diff, sqp);
    const close = closes[closes.length - 1];
    if (hma === null || close === undefined || hma <= 0) {
      return null;
    }
    const dev = (close - hma) / hma;
    if (Math.abs(dev) < config.threshold) {
      return null;
    }
    return dev > 0 ? "down" : "up";
  },
};

registerFilter({
  filter: hullMaPosition as Filter<unknown>,
  defaultConfigs: () => [
    { period: 20, threshold: 0.01 },
    { period: 50, threshold: 0.01 },
    { period: 20, threshold: 0.005 },
    { period: 14, threshold: 0.003 },
    { period: 20, threshold: 0.003 },
  ],
});
