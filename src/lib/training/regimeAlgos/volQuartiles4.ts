import type {
  RegimeAlgo,
  RegimeClassifierInput,
  RegimeLabel,
} from "@alea/lib/training/regimeAlgos/types";

/**
 * Quartile cuts on ATR-14 / ATR-50 chosen empirically from the May 2026
 * BTC distribution: with the 1.0 median already known, the 25th
 * percentile of the ratio sits near 0.6 and the 75th percentile near
 * 1.5. These split the population into four roughly equal-population
 * vol buckets without per-asset percentile computation.
 *
 * The win over `volOnly3Algo` is more uniform sample weight per
 * bucket; the cost is sharper boundaries that may merge or split the
 * "structurally low" and "structurally high" zones at the wrong
 * threshold for non-BTC assets. Treat the quartile values as a v1
 * approximation — a per-asset rolling percentile would be cleaner
 * but is significantly more code.
 */
const Q1 = 0.6;
const Q2 = 1.0;
const Q3 = 1.5;

const REGIMES = [
  "vol_q1_lowest",
  "vol_q2",
  "vol_q3",
  "vol_q4_highest",
] as const satisfies readonly RegimeLabel[];

export const volQuartiles4Algo: RegimeAlgo = {
  id: "vol_quartiles_4",
  displayName: "Vol quartiles",
  description:
    "Four-bucket vol split on ATR-14 ÷ ATR-50: q1 (≤ 0.6), q2 (0.6–1.0], q3 (1.0–1.5], q4 (> 1.5). Quartile-style cuts isolate the extreme tails from the central population.",
  version: 1,
  regimes: REGIMES,
  params: { q1: Q1, q2: Q2, q3: Q3 },
  classify: ({ atr14, atr50 }: RegimeClassifierInput): RegimeLabel | null => {
    if (atr14 === null || atr50 === null) {
      return null;
    }
    if (atr14 <= 0 || atr50 <= 0) {
      return null;
    }
    const ratio = atr14 / atr50;
    if (ratio <= Q1) {
      return "vol_q1_lowest";
    }
    if (ratio <= Q2) {
      return "vol_q2";
    }
    if (ratio <= Q3) {
      return "vol_q3";
    }
    return "vol_q4_highest";
  },
};
