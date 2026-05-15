import { requirePositiveInteger } from "@alea/lib/indicators/shared/series";
import type { MarketBar } from "@alea/lib/marketSeries/types";

export type WickRejectionKind = "bearish_high_sweep" | "bullish_low_sweep";

export type WickRejectionSignal = {
  readonly kind: WickRejectionKind;
  readonly index: number;
  readonly priorExtreme: number;
  readonly wickToRange: number;
};

export type ComputeWickRejectionSignalsParams = {
  readonly bars: readonly MarketBar[];
  readonly lookbackBars?: number;
  readonly minWickToRange?: number;
};

export function computeWickRejectionSignals({
  bars,
  lookbackBars = 12,
  minWickToRange = 0.45,
}: ComputeWickRejectionSignalsParams): readonly WickRejectionSignal[] {
  requirePositiveInteger({ name: "lookbackBars", value: lookbackBars });
  if (
    !Number.isFinite(minWickToRange) ||
    minWickToRange <= 0 ||
    minWickToRange >= 1
  ) {
    throw new Error("minWickToRange must be greater than 0 and less than 1");
  }

  const signals: WickRejectionSignal[] = [];
  for (let i = lookbackBars; i < bars.length; i += 1) {
    const bar = bars[i]!;
    const range = bar.high - bar.low;
    if (range <= 0) {
      continue;
    }
    const prior = bars.slice(i - lookbackBars, i);
    const priorHigh = Math.max(...prior.map((candidate) => candidate.high));
    const priorLow = Math.min(...prior.map((candidate) => candidate.low));
    const upperWickToRange = (bar.high - Math.max(bar.open, bar.close)) / range;
    const lowerWickToRange = (Math.min(bar.open, bar.close) - bar.low) / range;

    if (
      bar.high > priorHigh &&
      bar.close < priorHigh &&
      upperWickToRange >= minWickToRange
    ) {
      signals.push({
        kind: "bearish_high_sweep",
        index: i,
        priorExtreme: priorHigh,
        wickToRange: upperWickToRange,
      });
    }

    if (
      bar.low < priorLow &&
      bar.close > priorLow &&
      lowerWickToRange >= minWickToRange
    ) {
      signals.push({
        kind: "bullish_low_sweep",
        index: i,
        priorExtreme: priorLow,
        wickToRange: lowerWickToRange,
      });
    }
  }

  return signals;
}
