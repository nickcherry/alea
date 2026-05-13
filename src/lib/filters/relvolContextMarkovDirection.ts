import { closeLocation } from "@alea/lib/filters/_barMath";
import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter, FilterBar } from "@alea/lib/filters/types";
import { z } from "zod";

/**
 * Empirical-history Markov filter conditioned on a volume-aware
 * context. For the latest bar, the context is:
 *
 *   - the body-sign sequence of the trailing `contextBars`
 *   - the latest bar's relative-volume bucket
 *   - optionally, the latest bar's close-location bucket
 *
 * The filter scans the trailing `sampleLookback` bars for matches
 * to that exact context. For every match, the SUBSEQUENT bar's
 * direction (up if close > open, down if close < open) is
 * tallied. If the tally clears `minSamples` and the dominant
 * fraction clears `minProb`, the filter emits that direction.
 *
 * This is not a hand-coded "if volume + body → trade" — it's a
 * conditional-probability read against the asset's own recent
 * history.
 */
const configSchema = z.object({
  contextBars: z.number().int().positive().default(2),
  sampleLookback: z.number().int().positive().default(500),
  minSamples: z.number().int().positive().default(30),
  minProb: z.number().min(0.5).max(1).default(0.58),
  volLength: z.number().int().positive().default(20),
  volumeBuckets: z.number().int().min(2).max(6).default(3),
  includeCloseLocation: z.boolean().default(true),
});
type Config = z.infer<typeof configSchema>;

function relVolBucket({
  relVol,
  buckets,
}: {
  readonly relVol: number;
  readonly buckets: number;
}): number {
  // Fixed-threshold bucketing, indexed [0..buckets-1].
  // 2: [<1, >=1]
  // 3: [<1, 1-1.5, >=1.5]
  // 4: [<1, 1-1.5, 1.5-2.5, >=2.5]
  // 5: [<0.7, 0.7-1, 1-1.5, 1.5-2.5, >=2.5]
  // 6: [<0.7, 0.7-1, 1-1.5, 1.5-2.5, 2.5-4, >=4]
  switch (buckets) {
    case 2:
      return relVol < 1 ? 0 : 1;
    case 3:
      if (relVol < 1) return 0;
      if (relVol < 1.5) return 1;
      return 2;
    case 4:
      if (relVol < 1) return 0;
      if (relVol < 1.5) return 1;
      if (relVol < 2.5) return 2;
      return 3;
    case 5:
      if (relVol < 0.7) return 0;
      if (relVol < 1) return 1;
      if (relVol < 1.5) return 2;
      if (relVol < 2.5) return 3;
      return 4;
    default:
      if (relVol < 0.7) return 0;
      if (relVol < 1) return 1;
      if (relVol < 1.5) return 2;
      if (relVol < 2.5) return 3;
      if (relVol < 4) return 4;
      return 5;
  }
}

function closeLocBucket({ cl }: { readonly cl: number }): number {
  if (cl < 1 / 3) return 0;
  if (cl < 2 / 3) return 1;
  return 2;
}

function bodySign(bar: FilterBar): -1 | 0 | 1 {
  if (bar.close > bar.open) return 1;
  if (bar.close < bar.open) return -1;
  return 0;
}

export const relvolContextMarkovDirection: Filter<Config> = {
  id: "relvol_context_markov_direction",
  version: 1,
  barSource: "coinbase",
  family: "empirical_volume_sequence",
  description:
    "Empirical conditional-probability filter. Encodes the latest bar's body-sign sequence, relVol bucket, and optional close-location bucket, then scans the trailing history for the same context and tallies next-bar outcomes; emits when the dominant fraction clears `minProb` on at least `minSamples` matches.",
  configSchema,
  requiredBars: (c) =>
    c.sampleLookback + Math.max(c.volLength, c.contextBars) + 2,
  predict: (config, bars) => {
    const n = bars.length;
    if (n - 1 - config.volLength < 0) {
      return null;
    }
    // Rolling volume sum so we get O(n) relVol bucketing across the
    // whole window instead of O(n * volLength) inside the match
    // loop.
    const volLength = config.volLength;
    const sumVol = new Float64Array(n);
    {
      let running = 0;
      for (let i = 0; i < n; i += 1) {
        if (i > 0) {
          running += bars[i - 1]!.volume;
        }
        if (i > volLength) {
          running -= bars[i - 1 - volLength]!.volume;
        }
        sumVol[i] = running;
      }
    }

    // Per-bar precomputed buckets and body signs. -1 sentinel for
    // "unavailable" (warm-up not satisfied, doji close-location
    // undefined, etc).
    const volBucket = new Int8Array(n).fill(-1);
    const clBucket = new Int8Array(n).fill(-1);
    const bSign = new Int8Array(n);
    for (let i = 0; i < n; i += 1) {
      const bar = bars[i];
      if (bar === undefined) {
        continue;
      }
      bSign[i] = bodySign(bar);
      if (i >= volLength) {
        const avg = sumVol[i]! / volLength;
        if (avg > 0) {
          volBucket[i] = relVolBucket({
            relVol: bar.volume / avg,
            buckets: config.volumeBuckets,
          });
        }
      }
      const cl = closeLocation(bar);
      if (cl !== null) {
        clBucket[i] = closeLocBucket({ cl });
      }
    }

    const includeCl = config.includeCloseLocation;
    const cb = config.contextBars;

    function keyAt(i: number): string | null {
      if (i - cb + 1 < 0) {
        return null;
      }
      const v = volBucket[i];
      if (v === -1) {
        return null;
      }
      let key: string;
      if (includeCl) {
        const c = clBucket[i];
        if (c === -1) {
          return null;
        }
        key = `${v}:${c}`;
      } else {
        key = `${v}`;
      }
      for (let k = cb - 1; k >= 0; k -= 1) {
        key += `:${bSign[i - k]}`;
      }
      return key;
    }

    const latestKey = keyAt(n - 1);
    if (latestKey === null) {
      return null;
    }
    let up = 0;
    let down = 0;
    const start = Math.max(
      cb - 1,
      volLength,
      n - 1 - config.sampleLookback,
    );
    for (let i = start; i <= n - 2; i += 1) {
      if (keyAt(i) !== latestKey) {
        continue;
      }
      const next = bars[i + 1];
      if (next === undefined) {
        continue;
      }
      if (next.close > next.open) {
        up += 1;
      } else if (next.close < next.open) {
        down += 1;
      }
    }
    const total = up + down;
    if (total < config.minSamples) {
      return null;
    }
    if (up / total >= config.minProb) {
      return "up";
    }
    if (down / total >= config.minProb) {
      return "down";
    }
    return null;
  },
};

registerFilter({
  filter: relvolContextMarkovDirection as Filter<unknown>,
  defaultConfigs: () => [
    { contextBars: 2, sampleLookback: 500, minSamples: 30, minProb: 0.58, volLength: 20, volumeBuckets: 3, includeCloseLocation: true },
    { contextBars: 3, sampleLookback: 800, minSamples: 25, minProb: 0.6, volLength: 20, volumeBuckets: 3, includeCloseLocation: true },
    { contextBars: 4, sampleLookback: 1200, minSamples: 20, minProb: 0.62, volLength: 50, volumeBuckets: 4, includeCloseLocation: false },
    { contextBars: 3, sampleLookback: 1500, minSamples: 40, minProb: 0.58, volLength: 50, volumeBuckets: 4, includeCloseLocation: true },
    { contextBars: 5, sampleLookback: 2000, minSamples: 15, minProb: 0.65, volLength: 50, volumeBuckets: 3, includeCloseLocation: false },
  ],
});
