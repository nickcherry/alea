import {
  type FilterEvaluation,
  pythSpotCandleSource,
  type TradingFilter,
} from "@alea/lib/filters/types";
import { computeWilderRsiSeries } from "@alea/lib/indicators/rsi";
import {
  computeRsiDivergenceSignals,
  type RsiDivergenceKind,
  type RsiDivergenceSignal,
} from "@alea/lib/indicators/rsiDivergence";

export type RsiDivergenceConfig = {
  readonly rsiLength: number;
  readonly includeHidden: boolean;
  readonly leftBars: number;
  readonly rightBars: number;
  readonly rangeLower: number;
  readonly rangeUpper: number;
  readonly minSignalAgeBars?: number;
  readonly maxSignalAgeBars: number;
};

/**
 * Matches TradingView's RSI Divergence indicator on closed 1h bars.
 *
 * Computes Wilder RSI on close, confirms RSI pivot highs and lows
 * with `leftBars`/`rightBars` lookbacks, then compares the immediately
 * previous RSI pivot inside `[rangeLower, rangeUpper]` for divergence.
 *
 * A **regular bullish** divergence (price made a lower low while RSI
 * made a higher low) inside the recency window votes UP. A **regular
 * bearish** divergence (price higher high, RSI lower high) votes
 * DOWN. **Hidden** divergences (continuation patterns) can be
 * included via `includeHidden`.
 *
 * Under the take-profit-within-N-bars outcome model there is no
 * thesis lifecycle — every entry candle is judged independently and
 * the trade either reaches TP within the outcome window or doesn't.
 */
export const rsiDivergenceFilter: TradingFilter<RsiDivergenceConfig> = {
  id: "rsi_divergence",
  name: "RSI Divergence",
  version: 7,
  description:
    "Matches TradingView's RSI Divergence indicator on closed 1h bars. Wilder RSI on close, pivot confirmation via leftBars/rightBars, compare to the immediately previous RSI pivot inside [rangeLower, rangeUpper]. Regular-bullish votes up, regular-bearish votes down, hidden divergences are opt-in.",
  sources: [pythSpotCandleSource],
  evaluate({ bars, config }) {
    validateRsiDivergenceConfig(config);
    if (bars.length <= config.rsiLength + config.leftBars + config.rightBars) {
      return {
        decision: "neutral",
        reason: "not enough bars for RSI pivots",
      };
    }
    const closes = bars.map((bar) => bar.close);
    const rsi = computeWilderRsiSeries({
      closes,
      period: config.rsiLength,
    });
    const signals = computeRsiDivergenceSignals({
      bars,
      rsi,
      leftBars: config.leftBars,
      rightBars: config.rightBars,
      rangeLower: config.rangeLower,
      rangeUpper: config.rangeUpper,
    });
    const lastIndex = bars.length - 1;
    const signal = selectRecentRsiDivergenceSignal({
      signals,
      lastIndex,
      config,
    });
    if (signal === undefined) {
      return {
        decision: "neutral",
        reason: "no RSI divergence confirmed inside the recency window",
      };
    }
    const decision: FilterEvaluation["decision"] = isBullish(signal.kind)
      ? "up"
      : "down";
    const barsAgo = lastIndex - signal.confirmedIndex;
    return {
      decision,
      reason:
        barsAgo === 0
          ? `${signal.kind.replaceAll("_", " ")} confirmed on the last closed bar`
          : `${signal.kind.replaceAll("_", " ")} confirmed ${barsAgo} bar(s) ago`,
      metadata: {
        kind: signal.kind,
        pivotIndex: signal.pivotIndex,
        previousPivotIndex: signal.previousPivotIndex,
        confirmedIndex: signal.confirmedIndex,
        barsAgo,
        rsi: signal.rsi,
        previousRsi: signal.previousRsi,
      },
    };
  },
};

export function selectRecentRsiDivergenceSignal({
  signals,
  lastIndex,
  config,
}: {
  readonly signals: readonly RsiDivergenceSignal[];
  readonly lastIndex: number;
  readonly config: RsiDivergenceConfig;
}): RsiDivergenceSignal | undefined {
  return signals
    .filter((candidate) => includeSignal({ kind: candidate.kind, config }))
    .filter((candidate) => candidate.confirmedIndex <= lastIndex)
    .filter((candidate) => {
      const barsAgo = lastIndex - candidate.confirmedIndex;
      return (
        barsAgo >= (config.minSignalAgeBars ?? 0) &&
        barsAgo <= config.maxSignalAgeBars
      );
    })
    .at(-1);
}

function includeSignal({
  kind,
  config,
}: {
  readonly kind: RsiDivergenceKind;
  readonly config: RsiDivergenceConfig;
}): boolean {
  return config.includeHidden || !kind.startsWith("hidden_");
}

function isBullish(kind: RsiDivergenceKind): boolean {
  return kind === "regular_bullish" || kind === "hidden_bullish";
}

function validateRsiDivergenceConfig(config: RsiDivergenceConfig): void {
  for (const key of ["rsiLength", "leftBars", "rightBars"] as const) {
    if (!Number.isInteger(config[key]) || config[key] <= 0) {
      throw new Error(`${key} must be a positive integer`);
    }
  }
  for (const key of ["rangeLower", "rangeUpper", "maxSignalAgeBars"] as const) {
    if (!Number.isInteger(config[key]) || config[key] < 0) {
      throw new Error(`${key} must be a non-negative integer`);
    }
  }
  if (
    config.minSignalAgeBars !== undefined &&
    (!Number.isInteger(config.minSignalAgeBars) || config.minSignalAgeBars < 0)
  ) {
    throw new Error("minSignalAgeBars must be a non-negative integer");
  }
  if (config.rangeLower > config.rangeUpper) {
    throw new Error("rangeLower must be <= rangeUpper");
  }
}
