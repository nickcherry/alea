import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeBollingerSeries } from "@alea/lib/indicators/bollinger";
import { z } from "zod";

/**
 * Bollinger Band reversion. Engages UP when the latest close is at or
 * below the lower band ("oversold relative to recent vol"), DOWN
 * when it's at or above the upper band ("overbought relative to
 * recent vol"). Abstains in the middle.
 *
 * Bollinger Bands are a vol-scaled distance-from-MA test, so this
 * is structurally similar to `rsi_meanrev` but uses recent
 * volatility as the threshold scale (versus RSI's gain/loss-ratio
 * smoothing).
 */
const configSchema = z.object({
  period: z.number().int().positive().default(20),
  multiplier: z.number().positive().default(2),
});
type Config = z.infer<typeof configSchema>;

export const bollingerReversion: Filter<Config> = {
  id: "bollinger_reversion",
  version: 1,
  barSource: "pyth",
  family: "band_reversion",
  description:
    "Two-sided Bollinger Band reversion. Engages UP when the latest close pierces or touches the lower band (mean − `multiplier` × stddev over `period` bars), DOWN when it pierces or touches the upper band. Abstains between the bands. Same mean-reversion bet as `rsi_meanrev` but the threshold scales with recent volatility instead of recent gain/loss balance.",
  configSchema,
  requiredBars: (c) => c.period,
  predict: (config, bars) => {
    const closes = bars.map((b) => b.close);
    const { upper, lower } = computeBollingerSeries({
      closes,
      period: config.period,
      multiplier: config.multiplier,
    });
    const lastIdx = closes.length - 1;
    const close = closes[lastIdx];
    const up = upper[lastIdx];
    const lo = lower[lastIdx];
    if (
      close === undefined ||
      up === null ||
      up === undefined ||
      lo === null ||
      lo === undefined
    ) {
      return null;
    }
    if (close <= lo) {
      return "up";
    }
    if (close >= up) {
      return "down";
    }
    return null;
  },
};

registerFilter({
  filter: bollingerReversion as Filter<unknown>,
  defaultConfigs: () => [
    { period: 14, multiplier: 3 },
    { period: 14, multiplier: 2.5 },
    { period: 20, multiplier: 3 },
    { period: 20, multiplier: 2.5 },
    { period: 14, multiplier: 2 },
    { period: 14, multiplier: 3.5 },
    { period: 10, multiplier: 2.5 },
    { period: 10, multiplier: 3 },
    { period: 20, multiplier: 3.5 },
  ],
});
