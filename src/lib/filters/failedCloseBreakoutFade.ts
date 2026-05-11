import {
  highestHigh,
  lowestLow,
} from "@alea/lib/filters/_barMath";
import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeAtrSeries } from "@alea/lib/indicators/atr";
import { z } from "zod";

const configSchema = z.object({
  lookback: z.number().int().positive().default(20),
  atrLength: z.number().int().positive().default(14),
  minBreakAtr: z.number().nonnegative().default(0.1),
  failureBars: z.number().int().positive().default(1),
});
type Config = z.infer<typeof configSchema>;

export const failedCloseBreakoutFade: Filter<Config> = {
  id: "failed_close_breakout_fade",
  version: 1,
  family: "structure_reversion",
  description:
    "Fades failed close-breakouts. A prior bar must close beyond its trailing channel by at least `minBreakAtr`; if the latest close gets back inside within `failureBars`, predict reversal.",
  configSchema,
  requiredBars: (c) =>
    Math.max(c.lookback + c.failureBars + 1, c.atrLength + c.failureBars + 2),
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
    });
    for (
      let breakoutIndex = n - 1 - config.failureBars;
      breakoutIndex <= n - 2;
      breakoutIndex += 1
    ) {
      const breakoutBar = bars[breakoutIndex];
      const baselineAtr = atr[breakoutIndex - 1];
      if (
        breakoutBar === undefined ||
        baselineAtr === null ||
        baselineAtr === undefined ||
        baselineAtr <= 0
      ) {
        continue;
      }
      const priorHigh = highestHigh({
        bars,
        start: breakoutIndex - config.lookback,
        endExclusive: breakoutIndex,
      });
      const priorLow = lowestLow({
        bars,
        start: breakoutIndex - config.lookback,
        endExclusive: breakoutIndex,
      });
      if (priorHigh === null || priorLow === null) {
        continue;
      }
      const minBreak = config.minBreakAtr * baselineAtr;
      if (
        breakoutBar.close - priorHigh >= minBreak &&
        latest.close < priorHigh
      ) {
        return "down";
      }
      if (
        priorLow - breakoutBar.close >= minBreak &&
        latest.close > priorLow
      ) {
        return "up";
      }
    }
    return null;
  },
};

registerFilter({
  filter: failedCloseBreakoutFade as Filter<unknown>,
  defaultConfigs: () => [
    { lookback: 20, atrLength: 14, minBreakAtr: 0.1, failureBars: 1 },
    { lookback: 20, atrLength: 14, minBreakAtr: 0.2, failureBars: 1 },
    { lookback: 50, atrLength: 14, minBreakAtr: 0.1, failureBars: 2 },
    { lookback: 14, atrLength: 7, minBreakAtr: 0.1, failureBars: 1 },
    { lookback: 30, atrLength: 14, minBreakAtr: 0.25, failureBars: 2 },
  ],
});

