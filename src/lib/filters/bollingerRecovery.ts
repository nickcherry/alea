import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeBollingerSeries } from "@alea/lib/indicators/bollinger";
import { z } from "zod";

/**
 * Bollinger pierce recovery. Engages only after we've seen a band
 * pierce AND a close back inside the band — i.e. the reversion has
 * already started by one bar:
 *
 *   bar i-1: close ≤ lower band   →   bar i: close > lower band   →   predict UP
 *   bar i-1: close ≥ upper band   →   bar i: close < upper band   →   predict DOWN
 *
 * The basic `bollinger_reversion` engages the moment a close exits
 * the band, betting on a future reversion. This filter waits one
 * more bar for the actual recovery to confirm before engaging.
 * Hypothesis: confirmation costs us one bar of opportunity but pays
 * back with a noticeably higher per-engagement WR, because we no longer
 * engage on the bars that just keep going. The tradeoff between
 * "earlier signal at modest edge" (the basic version) and "later
 * signal at higher edge" (this one) is exactly the kind of thing
 * the dashboard quarter-strip is good for visualising.
 *
 * Bands are computed on closes only; bar i-1 and bar i are both
 * read for their close + the bands AT each bar (band moves with
 * price, so "inside" is recomputed bar-by-bar — same as how the
 * pattern would look on a chart).
 */
const configSchema = z.object({
  length: z.number().int().positive().default(20),
  multiplier: z.number().positive().default(2),
});
type Config = z.infer<typeof configSchema>;

export const bollingerRecovery: Filter<Config> = {
  id: "bollinger_recovery",
  version: 1,
  barSource: "pyth",
  family: "band_reversion",
  description:
    "Engages after a confirmed Bollinger pierce + recovery: bar i-1 closes outside the band, bar i closes back inside, predict continued reversion at bar i+1. Lagged-confirmation sibling of `bollinger_reversion`; trades earlier-and-cheaper for later-and-cleaner.",
  configSchema,
  requiredBars: (c) => c.length + 2,
  predict: (config, bars) => {
    const closes = bars.map((b) => b.close);
    const { upper, lower } = computeBollingerSeries({
      closes,
      period: config.length,
      multiplier: config.multiplier,
    });
    const i = closes.length - 1;
    if (i < 1) {
      return null;
    }
    const cPrev = closes[i - 1];
    const cCurr = closes[i];
    const uPrev = upper[i - 1];
    const lPrev = lower[i - 1];
    const uCurr = upper[i];
    const lCurr = lower[i];
    if (
      cPrev === undefined ||
      cCurr === undefined ||
      uPrev === null ||
      uPrev === undefined ||
      lPrev === null ||
      lPrev === undefined ||
      uCurr === null ||
      uCurr === undefined ||
      lCurr === null ||
      lCurr === undefined
    ) {
      return null;
    }
    // Lower-side recovery → bullish.
    if (cPrev <= lPrev && cCurr > lCurr) {
      return "up";
    }
    // Upper-side recovery → bearish.
    if (cPrev >= uPrev && cCurr < uCurr) {
      return "down";
    }
    return null;
  },
};

registerFilter({
  filter: bollingerRecovery as Filter<unknown>,
  defaultConfigs: () => [
    { length: 20, multiplier: 3 },
    { length: 20, multiplier: 2.5 },
    { length: 14, multiplier: 2.5 },
    { length: 50, multiplier: 2.5 },
    { length: 50, multiplier: 3 },
  ],
});
