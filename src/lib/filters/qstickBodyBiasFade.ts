import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeAtrSeries } from "@alea/lib/indicators/atr";
import { z } from "zod";

const configSchema = z.object({
  length: z.number().int().positive().default(5),
  atrLength: z.number().int().positive().default(14),
  thresholdAtr: z.number().positive().default(0.15),
});
type Config = z.infer<typeof configSchema>;

export const qstickBodyBiasFade: Filter<Config> = {
  id: "qstick_body_bias_fade",
  version: 1,
  family: "body_momentum_reversion",
  description:
    "Qstick body-bias fade. If the average recent candle body is strongly positive versus ATR, predict DOWN; strongly negative predicts UP.",
  configSchema,
  requiredBars: (c) => Math.max(c.length, c.atrLength + 1),
  predict: (config, bars) => {
    const n = bars.length;
    let bodySum = 0;
    for (let i = n - config.length; i < n; i += 1) {
      const bar = bars[i];
      if (bar === undefined) {
        return null;
      }
      bodySum += bar.close - bar.open;
    }
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
    const qstickAtr = bodySum / config.length / atr;
    if (qstickAtr >= config.thresholdAtr) {
      return "down";
    }
    if (qstickAtr <= -config.thresholdAtr) {
      return "up";
    }
    return null;
  },
};

registerFilter({
  filter: qstickBodyBiasFade as Filter<unknown>,
  defaultConfigs: () => [
    { length: 5, atrLength: 14, thresholdAtr: 0.15 },
    { length: 10, atrLength: 14, thresholdAtr: 0.12 },
    { length: 14, atrLength: 14, thresholdAtr: 0.1 },
    { length: 5, atrLength: 7, thresholdAtr: 0.2 },
    { length: 20, atrLength: 14, thresholdAtr: 0.08 },
  ],
});

