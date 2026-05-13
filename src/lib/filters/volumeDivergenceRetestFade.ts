import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter, FilterBar } from "@alea/lib/filters/types";
import { computeAtrSeries } from "@alea/lib/indicators/atr";
import { z } from "zod";

/**
 * Retest fade with volume divergence. Price retests or slightly
 * breaks a prior swing high/low, but the volume on the second test
 * is meaningfully lower than the first — participation is fading.
 *
 * Signal:
 *  - Retest of prior high on lower volume → DOWN
 *  - Retest of prior low on lower volume → UP
 *
 * Knobs:
 *  - `lookback`: full window in which to find the prior extreme.
 *  - `minSeparation`: minimum bars between the prior extreme and the
 *    latest bar so we're not detecting the same swing.
 *  - `atrLength`, `toleranceAtr`: latest bar must come within
 *    `toleranceAtr * ATR` of the prior extreme (above on a high
 *    retest, below on a low retest).
 *  - `minVolumeDropFrac`: latest bar volume must be at least this
 *    fraction LOWER than the prior-extreme bar volume.
 *  - `minRejectionFrac`: latest bar must show some directional
 *    rejection — wick on the side of the retest as a fraction of
 *    its range.
 */
const configSchema = z.object({
  lookback: z.number().int().positive().default(50),
  minSeparation: z.number().int().positive().default(5),
  atrLength: z.number().int().positive().default(14),
  toleranceAtr: z.number().nonnegative().default(0.25),
  minVolumeDropFrac: z.number().min(0).max(1).default(0.3),
  minRejectionFrac: z.number().min(0).max(1).default(0.3),
});
type Config = z.infer<typeof configSchema>;

type PriorExtreme = {
  readonly idx: number;
  readonly value: number;
  readonly volume: number;
};

function findPriorExtreme({
  bars,
  start,
  endExclusive,
  field,
}: {
  readonly bars: readonly FilterBar[];
  readonly start: number;
  readonly endExclusive: number;
  readonly field: "high" | "low";
}): PriorExtreme | null {
  let best: PriorExtreme | null = null;
  for (let i = start; i < endExclusive; i += 1) {
    const bar = bars[i];
    if (bar === undefined) {
      return null;
    }
    if (best === null) {
      best = { idx: i, value: bar[field], volume: bar.volume };
      continue;
    }
    if (field === "high" ? bar.high > best.value : bar.low < best.value) {
      best = { idx: i, value: bar[field], volume: bar.volume };
    }
  }
  return best;
}

export const volumeDivergenceRetestFade: Filter<Config> = {
  id: "volume_divergence_retest_fade",
  version: 1,
  barSource: "coinbase",
  family: "volume_divergence_reversion",
  description:
    "Retest of a prior swing extreme on lower volume than the original test. High retest on lower volume → DOWN; low retest on lower volume → UP.",
  configSchema,
  requiredBars: (c) => Math.max(c.lookback + 1, c.atrLength + 2),
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
    })[n - 2];
    if (atr === null || atr === undefined || atr <= 0) {
      return null;
    }
    const lookbackStart = n - 1 - config.lookback;
    const priorEndExclusive = n - 1 - config.minSeparation;
    if (priorEndExclusive <= lookbackStart) {
      return null;
    }
    const priorHigh = findPriorExtreme({
      bars,
      start: Math.max(0, lookbackStart),
      endExclusive: priorEndExclusive,
      field: "high",
    });
    const priorLow = findPriorExtreme({
      bars,
      start: Math.max(0, lookbackStart),
      endExclusive: priorEndExclusive,
      field: "low",
    });
    const tolerance = config.toleranceAtr * atr;
    if (priorHigh !== null && priorHigh.volume > 0) {
      const within = Math.abs(latest.high - priorHigh.value) <= tolerance;
      const lowerVolume =
        (priorHigh.volume - latest.volume) / priorHigh.volume >=
        config.minVolumeDropFrac;
      const range = latest.high - latest.low;
      const upperWick = latest.high - Math.max(latest.open, latest.close);
      const rejection = range > 0 ? upperWick / range : 0;
      if (within && lowerVolume && rejection >= config.minRejectionFrac) {
        return "down";
      }
    }
    if (priorLow !== null && priorLow.volume > 0) {
      const within = Math.abs(latest.low - priorLow.value) <= tolerance;
      const lowerVolume =
        (priorLow.volume - latest.volume) / priorLow.volume >=
        config.minVolumeDropFrac;
      const range = latest.high - latest.low;
      const lowerWick = Math.min(latest.open, latest.close) - latest.low;
      const rejection = range > 0 ? lowerWick / range : 0;
      if (within && lowerVolume && rejection >= config.minRejectionFrac) {
        return "up";
      }
    }
    return null;
  },
};

registerFilter({
  filter: volumeDivergenceRetestFade as Filter<unknown>,
  defaultConfigs: () => [
    {
      lookback: 50,
      minSeparation: 5,
      atrLength: 14,
      toleranceAtr: 0.25,
      minVolumeDropFrac: 0.3,
      minRejectionFrac: 0.3,
    },
    {
      lookback: 80,
      minSeparation: 8,
      atrLength: 14,
      toleranceAtr: 0.3,
      minVolumeDropFrac: 0.4,
      minRejectionFrac: 0.35,
    },
    {
      lookback: 30,
      minSeparation: 4,
      atrLength: 7,
      toleranceAtr: 0.2,
      minVolumeDropFrac: 0.25,
      minRejectionFrac: 0.4,
    },
    {
      lookback: 100,
      minSeparation: 10,
      atrLength: 20,
      toleranceAtr: 0.35,
      minVolumeDropFrac: 0.35,
      minRejectionFrac: 0.3,
    },
    {
      lookback: 50,
      minSeparation: 5,
      atrLength: 14,
      toleranceAtr: 0.15,
      minVolumeDropFrac: 0.5,
      minRejectionFrac: 0.45,
    },
    // Stricter volume drop + rejection; mid-range lookback (winning axis on 5m).
    {
      lookback: 50,
      minSeparation: 5,
      atrLength: 14,
      toleranceAtr: 0.2,
      minVolumeDropFrac: 0.55,
      minRejectionFrac: 0.4,
    },
    {
      lookback: 60,
      minSeparation: 6,
      atrLength: 14,
      toleranceAtr: 0.2,
      minVolumeDropFrac: 0.45,
      minRejectionFrac: 0.4,
    },
    {
      lookback: 80,
      minSeparation: 8,
      atrLength: 14,
      toleranceAtr: 0.25,
      minVolumeDropFrac: 0.5,
      minRejectionFrac: 0.35,
    },
    {
      lookback: 40,
      minSeparation: 4,
      atrLength: 14,
      toleranceAtr: 0.18,
      minVolumeDropFrac: 0.6,
      minRejectionFrac: 0.45,
    },
  ],
});
