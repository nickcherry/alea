import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeAtrSeries } from "@alea/lib/indicators/atr";
import { computeEmaSeries } from "@alea/lib/indicators/ema";
import { computeSmaSeries } from "@alea/lib/indicators/sma";
import { z } from "zod";

/**
 * Keltner channel reversion. Same shape as `bollinger_reversion`:
 *
 *   middle = (S|E)MA(close, length)
 *   upper  = middle + multiplier · ATR(length)
 *   lower  = middle - multiplier · ATR(length)
 *
 * but with ATR-based bands instead of standard-deviation-based.
 * Fires DOWN when close pierces the upper band (revert toward the
 * middle), UP when close pierces the lower band.
 *
 * Hypothesis being tested: ATR weights every bar's range equally
 * regardless of direction; std-dev squares the deviation. On bursty
 * crypto where a single big bar can blow up the std-dev for a while,
 * ATR-anchored bands may be more stable across volatility regimes.
 * Side-by-side with `bollinger_reversion`, this filter says which
 * volatility measure is the better band generator.
 *
 * Middle-line choice (`useEma`) is exposed because the textbook
 * Keltner uses EMA but TradingView and some chartists default to
 * SMA. Cheap to test both.
 */
const configSchema = z.object({
  length: z.number().int().positive().default(20),
  multiplier: z.number().positive().default(2),
  useEma: z.boolean().default(true),
});
type Config = z.infer<typeof configSchema>;

export const keltnerReversion: Filter<Config> = {
  id: "keltner_reversion",
  version: 1,
  regime: "band_reversion",
  description:
    "Mean-reversion on Keltner channels (middle ± multiplier × ATR). Fires DOWN when close pierces the upper band, UP when it pierces the lower band, abstains otherwise. ATR-anchored sibling of `bollinger_reversion`; running them side-by-side tells us whether std-dev or ATR is the better volatility measure for band-based reversion on crypto bars.",
  configSchema,
  // ATR + EMA/SMA both need ~length bars; +1 for the prior-close
  // that ATR's first TR consumes.
  requiredBars: (c) => c.length + 1,
  predict: (config, bars) => {
    const closes = bars.map((b) => b.close);
    const highs = bars.map((b) => b.high);
    const lows = bars.map((b) => b.low);
    const middleSeries = config.useEma
      ? computeEmaSeries({ closes, period: config.length })
      : computeSmaSeries({ closes, period: config.length });
    const atrSeries = computeAtrSeries({
      highs,
      lows,
      closes,
      period: config.length,
    });
    const i = bars.length - 1;
    const middle = middleSeries[i];
    const atr = atrSeries[i];
    const close = closes[i];
    if (
      middle === null ||
      middle === undefined ||
      atr === null ||
      atr === undefined ||
      close === undefined ||
      atr <= 0
    ) {
      return null;
    }
    const upper = middle + config.multiplier * atr;
    const lower = middle - config.multiplier * atr;
    if (close >= upper) {
      return "down";
    }
    if (close <= lower) {
      return "up";
    }
    return null;
  },
};

registerFilter({
  filter: keltnerReversion as Filter<unknown>,
  defaultConfigs: () => [
    {"length":20,"useEma":false,"multiplier":3},
    {"length":20,"useEma":true,"multiplier":3},
    {"length":20,"useEma":true,"multiplier":2.5},
    {"length":20,"useEma":false,"multiplier":2.5},
    {"length":20,"useEma":false,"multiplier":2},
  ],
});
