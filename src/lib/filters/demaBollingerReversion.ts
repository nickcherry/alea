import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeBollingerSeries } from "@alea/lib/indicators/bollinger";
import { computeEmaSeries } from "@alea/lib/indicators/ema";
import { z } from "zod";

/**
 * Bollinger reversion on a Double-EMA (DEMA) smoothed close series.
 *
 *   DEMA = 2·EMA - EMA(EMA)
 *
 * DEMA reduces lag relative to a single EMA by subtracting the
 * lagging "EMA of EMA" from twice the EMA. Apply Bollinger Bands to
 * the DEMA series and engage on pierces — tests whether a less-laggy
 * smoothed input improves the basic Bollinger reversion signal.
 */
const configSchema = z.object({
  length: z.number().int().positive().default(20),
  multiplier: z.number().positive().default(2),
});
type Config = z.infer<typeof configSchema>;

export const demaBollingerReversion: Filter<Config> = {
  id: "dema_bollinger_reversion",
  version: 1,
  barSource: "pyth",
  family: "band_reversion",
  description:
    "Bollinger reversion on a DEMA-smoothed close series. DEMA reduces lag vs. a single EMA; tests whether a less-laggy smoothed input helps the basic Bollinger reversion signal.",
  configSchema,
  requiredBars: (c) => c.length * 2 + 2,
  predict: (config, bars) => {
    const closes = bars.map((b) => b.close);
    const ema1 = computeEmaSeries({ closes, period: config.length });
    // EMA of EMA — feed the first EMA's non-null tail through again.
    const ema1Filled = ema1.map((v, idx) =>
      v === null ? (closes[idx] ?? 0) : v,
    );
    const ema2 = computeEmaSeries({
      closes: ema1Filled,
      period: config.length,
    });
    const dema: number[] = new Array(closes.length).fill(0);
    for (let i = 0; i < closes.length; i += 1) {
      const e1 = ema1[i];
      const e2 = ema2[i];
      if (e1 === null || e1 === undefined || e2 === null || e2 === undefined) {
        dema[i] = closes[i] ?? 0;
        continue;
      }
      dema[i] = 2 * e1 - e2;
    }
    const { upper, lower } = computeBollingerSeries({
      closes: dema,
      period: config.length,
      multiplier: config.multiplier,
    });
    const i = dema.length - 1;
    const d = dema[i];
    const u = upper[i];
    const l = lower[i];
    if (
      d === undefined ||
      u === null ||
      u === undefined ||
      l === null ||
      l === undefined
    ) {
      return null;
    }
    if (d <= l) {
      return "up";
    }
    if (d >= u) {
      return "down";
    }
    return null;
  },
};

registerFilter({
  filter: demaBollingerReversion as Filter<unknown>,
  defaultConfigs: () => [
    { length: 14, multiplier: 2.5 },
    { length: 20, multiplier: 3 },
    { length: 20, multiplier: 2.5 },
    { length: 14, multiplier: 2 },
    { length: 20, multiplier: 2 },
    { length: 14, multiplier: 3 },
    { length: 14, multiplier: 3.5 },
    { length: 10, multiplier: 2.5 },
    { length: 30, multiplier: 3 },
  ],
});
