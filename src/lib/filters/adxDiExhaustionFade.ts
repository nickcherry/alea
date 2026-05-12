import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeAdxSeries } from "@alea/lib/indicators/adx";
import { z } from "zod";

const configSchema = z.object({
  length: z.number().int().positive().default(14),
  adxMin: z.number().nonnegative().default(40),
  diSpreadMin: z.number().nonnegative().default(25),
  spreadDropBars: z.number().int().positive().default(2),
  requireAdxTurnDown: z.boolean().default(true),
});
type Config = z.infer<typeof configSchema>;

export const adxDiExhaustionFade: Filter<Config> = {
  id: "adx_di_exhaustion_fade",
  version: 1,
  family: "trend_exhaustion",
  description:
    "Fades extreme ADX/DI trends as directional spread weakens. A dominant +DI trend rolling over predicts DOWN; dominant -DI rolling over predicts UP.",
  configSchema,
  requiredBars: (c) => 2 * c.length + c.spreadDropBars + 2,
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
      config.requireAdxTurnDown &&
      (previousAdx === null ||
        previousAdx === undefined ||
        currentAdx >= previousAdx)
    ) {
      return null;
    }
    const spread = plus - minus;
    const absSpread = Math.abs(spread);
    if (absSpread < config.diSpreadMin) {
      return null;
    }
    for (let offset = 1; offset <= config.spreadDropBars; offset += 1) {
      const priorPlus = plusDi[i - offset];
      const priorMinus = minusDi[i - offset];
      if (
        priorPlus === null ||
        priorPlus === undefined ||
        priorMinus === null ||
        priorMinus === undefined
      ) {
        return null;
      }
      const priorAbsSpread = Math.abs(priorPlus - priorMinus);
      if (priorAbsSpread <= absSpread) {
        return null;
      }
    }
    return spread > 0 ? "down" : "up";
  },
};

registerFilter({
  filter: adxDiExhaustionFade as Filter<unknown>,
  defaultConfigs: () => [
    {
      length: 14,
      adxMin: 40,
      diSpreadMin: 25,
      spreadDropBars: 2,
      requireAdxTurnDown: true,
    },
    {
      length: 14,
      adxMin: 35,
      diSpreadMin: 20,
      spreadDropBars: 1,
      requireAdxTurnDown: true,
    },
    {
      length: 7,
      adxMin: 45,
      diSpreadMin: 25,
      spreadDropBars: 1,
      requireAdxTurnDown: false,
    },
    {
      length: 20,
      adxMin: 35,
      diSpreadMin: 20,
      spreadDropBars: 2,
      requireAdxTurnDown: true,
    },
    {
      length: 14,
      adxMin: 30,
      diSpreadMin: 30,
      spreadDropBars: 1,
      requireAdxTurnDown: false,
    },
  ],
});
