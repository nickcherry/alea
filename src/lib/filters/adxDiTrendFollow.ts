import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeAdxSeries } from "@alea/lib/indicators/adx";
import { z } from "zod";

const configSchema = z.object({
  length: z.number().int().positive().default(14),
  adxMin: z.number().nonnegative().default(25),
  diSpreadMin: z.number().nonnegative().default(10),
  requireAdxRising: z.boolean().default(false),
});
type Config = z.infer<typeof configSchema>;

export const adxDiTrendFollow: Filter<Config> = {
  id: "adx_di_trend_follow",
  version: 2,
  family: "trend_continuation",
  description:
    "Classic ADX/+DI/-DI trend follow. High ADX plus a sufficient +DI lead predicts UP; high ADX plus a sufficient -DI lead predicts DOWN.",
  configSchema,
  requiredBars: (c) => 2 * c.length + 2,
  predict: (config, bars) => {
    const highs = bars.map((b) => b.high);
    const lows = bars.map((b) => b.low);
    const closes = bars.map((b) => b.close);
    const { adx, plusDi, minusDi } = computeAdxSeries({
      highs,
      lows,
      closes,
      period: config.length,
    });
    const i = bars.length - 1;
    const currentAdx = adx[i];
    const previousAdx = adx[i - 1];
    const plus = plusDi[i];
    const minus = minusDi[i];
    if (
      currentAdx === null ||
      currentAdx === undefined ||
      plus === null ||
      plus === undefined ||
      minus === null ||
      minus === undefined ||
      currentAdx < config.adxMin
    ) {
      return null;
    }
    if (
      config.requireAdxRising &&
      (previousAdx === null ||
        previousAdx === undefined ||
        currentAdx <= previousAdx)
    ) {
      return null;
    }
    if (plus - minus >= config.diSpreadMin) {
      return "up";
    }
    if (minus - plus >= config.diSpreadMin) {
      return "down";
    }
    return null;
  },
};

registerFilter({
  filter: adxDiTrendFollow as Filter<unknown>,
  defaultConfigs: () => [
    { length: 14, adxMin: 25, diSpreadMin: 8, requireAdxRising: false },
    { length: 14, adxMin: 30, diSpreadMin: 8, requireAdxRising: true },
    { length: 7, adxMin: 30, diSpreadMin: 12, requireAdxRising: false },
    { length: 20, adxMin: 25, diSpreadMin: 8, requireAdxRising: true },
    { length: 14, adxMin: 20, diSpreadMin: 15, requireAdxRising: false },
  ],
});
