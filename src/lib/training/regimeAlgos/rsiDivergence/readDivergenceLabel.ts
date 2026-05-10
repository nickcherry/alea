import type { RegimeClassifierInput } from "@alea/lib/training/regimeAlgos/types";
import type { RsiDivergenceLabel } from "@alea/lib/training/regimeAlgos/rsiDivergence/types";

export type DivergenceTimeframe = "5m" | "15m";
export type DivergenceLookback = 3 | 5 | 7;

/**
 * Pulls the right precomputed divergence label out of the classifier
 * input for a given (timeframe, lookback) pair. The labels are
 * computed once per snapshot in `computeSurvivalSnapshots` /
 * `computeRegimeClassifierInput`; both the standalone divergence
 * algos and the vol×divergence cross-product algos read them through
 * this helper so the only place the field-name math lives is here.
 */
export function readDivergenceLabel({
  input,
  timeframe,
  lookbackBars,
}: {
  readonly input: RegimeClassifierInput;
  readonly timeframe: DivergenceTimeframe;
  readonly lookbackBars: DivergenceLookback;
}): RsiDivergenceLabel | null {
  if (timeframe === "5m") {
    if (lookbackBars === 3) {
      return input.rsiDivergence5mW3;
    }
    if (lookbackBars === 5) {
      return input.rsiDivergence5mW5;
    }
    return input.rsiDivergence5mW7;
  }
  if (lookbackBars === 3) {
    return input.rsiDivergence15mW3;
  }
  if (lookbackBars === 5) {
    return input.rsiDivergence15mW5;
  }
  return input.rsiDivergence15mW7;
}
