import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeEmaSeries } from "@alea/lib/indicators/ema";
import { z } from "zod";

/**
 * Disparity Index reversion.
 *
 *   DI = 100 × (close - EMA(close, length)) / EMA(close, length)
 *
 * The percent distance between close and its EMA — a single
 * normalized oscillator that's positive when above the EMA, negative
 * when below. Engages UP when DI ≤ -threshold (stretched below),
 * DOWN when DI ≥ +threshold (stretched above).
 *
 * Conceptually the same hypothesis as `ema_position` revert mode,
 * but framed as an oscillator (continuous threshold knob).
 */
const configSchema = z.object({
  length: z.number().int().positive().default(20),
  threshold: z.number().positive().default(1),
});
type Config = z.infer<typeof configSchema>;

export const disparityIndexReversion: Filter<Config> = {
  id: "disparity_index_reversion",
  version: 1,
  barSource: "pyth",
  family: "ma_position",
  description:
    "Mean reversion on the Disparity Index — percent distance between close and its EMA. Continuous-threshold formulation of the same hypothesis as `ema_position` revert mode.",
  configSchema,
  requiredBars: (c) => c.length + 2,
  predict: (config, bars) => {
    const closes = bars.map((b) => b.close);
    const ema = computeEmaSeries({ closes, period: config.length });
    const i = closes.length - 1;
    const c = closes[i];
    const e = ema[i];
    if (c === undefined || e === null || e === undefined || e <= 0) {
      return null;
    }
    const di = (100 * (c - e)) / e;
    if (di >= config.threshold) {
      return "down";
    }
    if (di <= -config.threshold) {
      return "up";
    }
    return null;
  },
};

registerFilter({
  filter: disparityIndexReversion as Filter<unknown>,
  defaultConfigs: () => [
    { length: 14, threshold: 1 },
    { length: 20, threshold: 2 },
    { length: 14, threshold: 0.5 },
    { length: 20, threshold: 1 },
    { length: 20, threshold: 0.5 },
  ],
});
