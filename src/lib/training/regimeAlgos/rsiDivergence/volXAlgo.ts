import type {
  RegimeAlgo,
  RegimeLabel,
} from "@alea/lib/training/regimeAlgos/types";
import { volOnly3Algo } from "@alea/lib/training/regimeAlgos/volOnly3";
import {
  type DivergenceLookback,
  type DivergenceTimeframe,
  readDivergenceLabel,
} from "@alea/lib/training/regimeAlgos/rsiDivergence/readDivergenceLabel";
import { RSI_DIVERGENCE_LABELS } from "@alea/lib/training/regimeAlgos/rsiDivergence/types";

/**
 * Cartesian product of `volOnly3Algo` × the five RSI-divergence
 * states, keyed `<vol>_<div>` (e.g., `low_vol_bull_div`,
 * `high_vol_no_div`). 3 vol tiers × 5 div states = 15 regimes per
 * variant. Same shape as `trend_x_vol_6` — a hand-built combined
 * partitioner that lets the prob-table picker compete cross-product
 * regimes against single-axis ones.
 *
 * Why vol_only_3 specifically: it's the strongest single-axis algo
 * in the persisted live probability table (low_vol consistently
 * leads the unconditional baseline by 3–7pp across assets). Pairing
 * the strongest base with each div variant tests whether the
 * divergence signal *interacts* with vol — i.e., maybe div is
 * uninformative on its own but separates outcomes within a
 * particular vol tier.
 */
const COMBINED_REGIMES: readonly RegimeLabel[] = (
  volOnly3Algo.regimes as readonly RegimeLabel[]
).flatMap((volLabel) =>
  RSI_DIVERGENCE_LABELS.map((divLabel) => `${volLabel}_${divLabel}`),
);

type AlgoConfig = {
  readonly timeframe: DivergenceTimeframe;
  readonly lookbackBars: DivergenceLookback;
};

export function createVolXRsiDivergenceAlgo({
  timeframe,
  lookbackBars,
}: AlgoConfig): RegimeAlgo {
  const id = `vol3_x_rsidiv_${timeframe}_w${lookbackBars}`;
  const displayName = `Vol × RSI div (${timeframe}, w${lookbackBars})`;
  const description =
    `Cross-product of vol_only_3 (3 buckets) and the RSI-divergence ` +
    `state on ${timeframe} candles with a ${lookbackBars}-bar lookback ` +
    `(5 buckets) — 15 combined labels named '<vol>_<div>'. ` +
    `Tests whether divergence patterns separate outcomes WITHIN a ` +
    `vol tier where neither axis alone gave a clean signal. Both ` +
    `inputs must classify; if either returns null the combined algo ` +
    `returns null and the snapshot is skipped.`;
  return {
    id,
    displayName,
    description,
    version: 1,
    regimes: COMBINED_REGIMES,
    params: {
      // Vol axis params (mirrored from volOnly3Algo for diagnostics).
      volLowCut: volOnly3Algo.params.lowCut!,
      volHighCut: volOnly3Algo.params.highCut!,
      // Div axis params.
      rsiLength: 14,
      pivotLookbackLeft: 5,
      pivotLookbackRight: 5,
      rangeLower: 5,
      rangeUpper: 60,
      lookbackBars,
    },
    classify: (input) => {
      const volLabel = volOnly3Algo.classify(input);
      if (volLabel === null) {
        return null;
      }
      const divLabel = readDivergenceLabel({
        input,
        timeframe,
        lookbackBars,
      });
      if (divLabel === null) {
        return null;
      }
      return `${volLabel}_${divLabel}`;
    },
  };
}

/**
 * Two combined variants — both with `lookbackBars=3` (the shortest
 * we trained), one each for 5m and 15m candle timeframes. The
 * 2026-05-10 prune kept these out of an initial set of six because
 * the w3 variants ranked highest on the cross-asset mean
 * `calibrationScore` ladder; the longer-lookback variants (w5, w7)
 * landed below them by a clear margin and didn't earn the dashboard
 * real estate. Resurrect a longer lookback in one line by appending
 * another `createVolXRsiDivergenceAlgo` call.
 */
export const volXRsiDivergenceAlgos: readonly RegimeAlgo[] = [
  createVolXRsiDivergenceAlgo({ timeframe: "5m", lookbackBars: 3 }),
  createVolXRsiDivergenceAlgo({ timeframe: "15m", lookbackBars: 3 }),
];
