import type { RegimeAlgo } from "@alea/lib/training/regimeAlgos/types";
import {
  type DivergenceLookback,
  type DivergenceTimeframe,
  readDivergenceLabel,
} from "@alea/lib/training/regimeAlgos/rsiDivergence/readDivergenceLabel";
import { RSI_DIVERGENCE_LABELS } from "@alea/lib/training/regimeAlgos/rsiDivergence/types";

type AlgoConfig = {
  readonly timeframe: DivergenceTimeframe;
  readonly lookbackBars: DivergenceLookback;
};

/**
 * Factory: produces a `RegimeAlgo` that partitions snapshots by RSI
 * divergence state. Six variants are registered (5m × {3,5,7} +
 * 15m × {3,5,7}) so we can compare timeframe sensitivity AND
 * "active divergence" lookback in the same training run.
 *
 * Pivot/range parameters are locked to the Pine Script defaults
 * (RSI 14, lbL=5, lbR=5, rangeLower=5, rangeUpper=60) — they're
 * applied uniformly inside the snapshot computer
 * (`computeSurvivalSnapshots.RSI_DIVERGENCE_DETECTION_CONFIG`).
 *
 * The classifier is pure: it just selects the right precomputed
 * label off the input. Everything that's actually expensive — Wilder
 * RSI, pivot scan, divergence flag merge, lookback walk — runs
 * once per asset in the snapshot pipeline, not per snapshot.
 */
export function createRsiDivergenceAlgo({
  timeframe,
  lookbackBars,
}: AlgoConfig): RegimeAlgo {
  const id = `rsi_div_${timeframe}_w${lookbackBars}`;
  const displayName = `RSI divergence (${timeframe}, w${lookbackBars})`;
  const description =
    `Five-bucket RSI-divergence partition on ${timeframe} candles. ` +
    `Tags each window by which divergence pattern (regular/hidden, ` +
    `bull/bear) most recently fired in the past ${lookbackBars} ` +
    `${timeframe} bars, or 'no_div' if none did. Pivot/range ` +
    `parameters are the Pine Script defaults: RSI 14, pivot lookback ` +
    `5/5, range 5–60. Tiebreaker on same-bar firings: regular > ` +
    `hidden, bull > bear.`;
  return {
    id,
    displayName,
    description,
    version: 1,
    regimes: RSI_DIVERGENCE_LABELS,
    params: {
      rsiLength: 14,
      pivotLookbackLeft: 5,
      pivotLookbackRight: 5,
      rangeLower: 5,
      rangeUpper: 60,
      lookbackBars,
    },
    classify: (input) =>
      readDivergenceLabel({ input, timeframe, lookbackBars }),
  };
}

/**
 * The full set of 6 divergence variants we want trained side-by-side.
 * Order is the dashboard render order — 5m group first, then 15m.
 */
export const rsiDivergenceAlgos: readonly RegimeAlgo[] = [
  createRsiDivergenceAlgo({ timeframe: "5m", lookbackBars: 3 }),
  createRsiDivergenceAlgo({ timeframe: "5m", lookbackBars: 5 }),
  createRsiDivergenceAlgo({ timeframe: "5m", lookbackBars: 7 }),
  createRsiDivergenceAlgo({ timeframe: "15m", lookbackBars: 3 }),
  createRsiDivergenceAlgo({ timeframe: "15m", lookbackBars: 5 }),
  createRsiDivergenceAlgo({ timeframe: "15m", lookbackBars: 7 }),
];
