import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeBollingerSeries } from "@alea/lib/indicators/bollinger";
import { computeHeikinAshiSeries } from "@alea/lib/indicators/heikinAshi";
import { z } from "zod";

/**
 * Heikin-Ashi Bollinger reversion. Transforms the OHLC series into
 * Heikin-Ashi candles, then runs the standard Bollinger reversion
 * on the smoothed HA closes:
 *
 *   HA series ← computeHeikinAshiSeries(bars)
 *   bands     ← Bollinger(HA_close, length, multiplier)
 *   if HA_close ≤ lower  →  engage UP
 *   if HA_close ≥ upper  →  engage DOWN
 *
 * Direct apples-to-apples test of "does smoothing the input help
 * the Bollinger reversion signal?". HA candles average raw OHLC
 * into closes that lag less than a moving average but dampen
 * single-bar noise more than the raw closes. If WR comes in above
 * `bollinger_reversion` (56.5% on 15m), HA smoothing is a real
 * improvement; if it's flat or worse, HA's smoothing is just
 * absorbing signal along with noise.
 *
 * The engagement condition uses HA_close, NOT the raw close — this is
 * a pure HA-on-HA test. A version that uses the raw close to
 * engaged on the raw close but HA bands for the level would be a different test.
 */
const configSchema = z.object({
  length: z.number().int().positive().default(20),
  multiplier: z.number().positive().default(2),
});
type Config = z.infer<typeof configSchema>;

export const heikinAshiReversion: Filter<Config> = {
  id: "heikin_ashi_reversion",
  version: 1,
  barSource: "pyth",
  family: "band_reversion",
  description:
    "Bollinger reversion on Heikin-Ashi candles. Identical decision tree to `bollinger_reversion` but the entire OHLC series is first transformed into HA candles, dampening single-bar noise. Head-to-head with the basic Bollinger reversion says whether smoothing the input is a net win.",
  configSchema,
  requiredBars: (c) => c.length + 1,
  predict: (config, bars) => {
    const opens = bars.map((b) => b.open);
    const highs = bars.map((b) => b.high);
    const lows = bars.map((b) => b.low);
    const closes = bars.map((b) => b.close);
    const { haClose } = computeHeikinAshiSeries({
      opens,
      highs,
      lows,
      closes,
    });
    const { upper, lower } = computeBollingerSeries({
      closes: haClose,
      period: config.length,
      multiplier: config.multiplier,
    });
    const i = haClose.length - 1;
    const c = haClose[i];
    const u = upper[i];
    const l = lower[i];
    if (
      c === undefined ||
      u === null ||
      u === undefined ||
      l === null ||
      l === undefined
    ) {
      return null;
    }
    if (c <= l) {
      return "up";
    }
    if (c >= u) {
      return "down";
    }
    return null;
  },
};

registerFilter({
  filter: heikinAshiReversion as Filter<unknown>,
  defaultConfigs: () => [
    { length: 14, multiplier: 3 },
    { length: 20, multiplier: 3 },
    { length: 14, multiplier: 2.5 },
    { length: 20, multiplier: 2.5 },
    { length: 14, multiplier: 2 },
    { length: 14, multiplier: 3.5 },
    { length: 10, multiplier: 2.5 },
    { length: 20, multiplier: 3.5 },
    { length: 10, multiplier: 3 },
  ],
});
