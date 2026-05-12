import { barRange } from "@alea/lib/filters/_barMath";
import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeAtrSeries } from "@alea/lib/indicators/atr";
import { z } from "zod";

const configSchema = z.object({
  insideBars: z.number().int().positive().default(1),
  atrLength: z.number().int().positive().default(14),
  minSweepAtr: z.number().nonnegative().default(0.05),
  minRejectionFrac: z.number().min(0).max(1).default(0.35),
});
type Config = z.infer<typeof configSchema>;

export const insideBarFakeoutFade: Filter<Config> = {
  id: "inside_bar_fakeout_fade",
  version: 1,
  family: "compression_failure",
  description:
    "Fades failed inside-bar breakouts. If the latest bar sweeps outside the mother range but closes back inside with enough wick rejection, predict the opposite direction.",
  configSchema,
  requiredBars: (c) => Math.max(c.insideBars + 2, c.atrLength + 2),
  predict: (config, bars) => {
    const n = bars.length;
    const latest = bars[n - 1];
    const mother = bars[n - config.insideBars - 2];
    if (latest === undefined || mother === undefined) {
      return null;
    }
    for (let i = n - config.insideBars - 1; i <= n - 2; i += 1) {
      const inside = bars[i];
      if (
        inside === undefined ||
        inside.high > mother.high ||
        inside.low < mother.low
      ) {
        return null;
      }
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
    const range = barRange(latest);
    if (atr === null || atr === undefined || atr <= 0 || range <= 0) {
      return null;
    }
    const minSweep = config.minSweepAtr * atr;
    const upperRejection = (latest.high - latest.close) / range;
    const lowerRejection = (latest.close - latest.low) / range;
    if (
      latest.high - mother.high >= minSweep &&
      latest.close < mother.high &&
      upperRejection >= config.minRejectionFrac
    ) {
      return "down";
    }
    if (
      mother.low - latest.low >= minSweep &&
      latest.close > mother.low &&
      lowerRejection >= config.minRejectionFrac
    ) {
      return "up";
    }
    return null;
  },
};

registerFilter({
  filter: insideBarFakeoutFade as Filter<unknown>,
  defaultConfigs: () => [
    { insideBars: 1, atrLength: 14, minSweepAtr: 0.05, minRejectionFrac: 0.35 },
    { insideBars: 1, atrLength: 14, minSweepAtr: 0.1, minRejectionFrac: 0.45 },
    { insideBars: 2, atrLength: 14, minSweepAtr: 0.05, minRejectionFrac: 0.35 },
    { insideBars: 2, atrLength: 7, minSweepAtr: 0.1, minRejectionFrac: 0.4 },
    { insideBars: 3, atrLength: 14, minSweepAtr: 0.05, minRejectionFrac: 0.3 },
  ],
});
