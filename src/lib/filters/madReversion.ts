import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { z } from "zod";

/**
 * Robust z-score reversion using median + MAD (median absolute
 * deviation) instead of mean + standard deviation:
 *
 *   robust_z = (close - median_N) / MAD_N
 *   if  robust_z ≥ +threshold   →  DOWN
 *   if  robust_z ≤ -threshold   →  UP
 *
 * Resistant to a single outlier bar that would inflate the std-dev
 * basis of `zscore_reversion`. Tests whether the cleaner robust
 * statistics improve the reversion edge on bursty crypto bars.
 */
const configSchema = z.object({
  length: z.number().int().positive().default(20),
  threshold: z.number().positive().default(2),
});
type Config = z.infer<typeof configSchema>;

function median(sorted: readonly number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

export const madReversion: Filter<Config> = {
  id: "mad_reversion",
  version: 1,
  regime: "band_reversion",
  description:
    "Robust z-score reversion using median + median-absolute-deviation. Sibling of `zscore_reversion` but resistant to outlier bars that would inflate std-dev.",
  configSchema,
  requiredBars: (c) => c.length + 1,
  predict: (config, bars) => {
    const n = bars.length;
    const N = config.length;
    if (n < N) return null;
    const closes: number[] = [];
    for (let k = n - N; k <= n - 1; k += 1) {
      const c = bars[k]?.close;
      if (c === undefined) return null;
      closes.push(c);
    }
    const sorted = [...closes].sort((a, b) => a - b);
    const med = median(sorted);
    const devs = closes.map((c) => Math.abs(c - med)).sort((a, b) => a - b);
    const mad = median(devs);
    if (mad <= 0) return null;
    const current = closes[closes.length - 1]!;
    const z = (current - med) / mad;
    if (z >= config.threshold) return "down";
    if (z <= -config.threshold) return "up";
    return null;
  },
};

registerFilter({
  filter: madReversion as Filter<unknown>,
  defaultConfigs: () => [
    {"length":20,"threshold":4},
    {"length":20,"threshold":3},
    {"length":20,"threshold":2.5},
    {"length":14,"threshold":2},
    {"length":20,"threshold":2},
  ],
});
