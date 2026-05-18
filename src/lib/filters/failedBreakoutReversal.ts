import {
  type FailedBreakoutReversalBaseConfig,
  type FailedBreakoutReversalMatch,
  findRecentFailedBreakoutReversal,
} from "@alea/lib/filters/failedBreakoutReversalCore";
import {
  runThesisLifecycle,
  type ThesisLifecycleConfig,
  type ThesisStructuralCheck,
} from "@alea/lib/filters/thesisLifecycle";
import {
  type FilterEvaluation,
  pythSpotCandleSource,
  type TradingFilter,
} from "@alea/lib/filters/types";

export type FailedBreakoutReversalConfig = FailedBreakoutReversalBaseConfig &
  ThesisLifecycleConfig;

export const failedBreakoutReversalFilter: TradingFilter<FailedBreakoutReversalConfig> =
  {
    id: "failed_breakout_reversal",
    name: "Failed Breakout Reversal",
    version: 1,
    description:
      "Detects a sweep-and-reclaim of a prior N-bar low (bullish reversal) or prior N-bar high (bearish reversal). The trigger candle pierces the prior extreme but closes back across it with a strong close-location within its own range. While the thesis remains active, the next candles vote in the reversal direction until invalidated by age, consecutive wrong bars, an unfavorable right-vs-wrong tally, or a re-break of the trigger candle's sweep extreme. Configurable lookback window for the prior extreme, close-location threshold, signal recency window, and lifecycle invalidation rules.",
    sources: [pythSpotCandleSource],
    evaluate({ series, config }) {
      const match = findRecentFailedBreakoutReversal({
        bars: series.pyth,
        config,
      });
      return applyFailedBreakoutReversalLifecycle({ match, config });
    },
  };

export function applyFailedBreakoutReversalLifecycle({
  match,
  config,
}: {
  readonly match: FailedBreakoutReversalMatch;
  readonly config: ThesisLifecycleConfig;
}): FilterEvaluation {
  if (!match.matched) {
    return match.evaluation;
  }
  const structuralCheck = failedBreakoutReversalStructuralCheck({
    sweepExtreme: match.trigger.sweepExtreme,
  });
  const lifecycle = runThesisLifecycle({
    direction: match.trigger.direction,
    confirmedIndex: match.trigger.confirmedIndex,
    bars: match.bars,
    lastIndex: match.lastIndex,
    config,
    structuralCheck,
  });
  const baseMetadata = match.evaluation.metadata ?? {};
  if (lifecycle.invalidated) {
    return {
      decision: "neutral",
      reason: lifecycle.reason ?? "failed breakout reversal invalidated",
      metadata: { ...baseMetadata, ...lifecycle.metadata },
    };
  }
  return {
    ...match.evaluation,
    metadata: { ...baseMetadata, ...lifecycle.metadata },
  };
}

export function failedBreakoutReversalStructuralCheck({
  sweepExtreme,
}: {
  readonly sweepExtreme: number;
}): ThesisStructuralCheck {
  return ({ direction, bar }) => {
    if (direction === "up" && bar.low < sweepExtreme) {
      return {
        invalidated: true,
        reason: "price re-broke sweep low after failed-breakdown reclaim",
        metadata: { structuralBreakAt: bar.low, sweepExtreme },
      };
    }
    if (direction === "down" && bar.high > sweepExtreme) {
      return {
        invalidated: true,
        reason: "price re-broke sweep high after failed-breakout rejection",
        metadata: { structuralBreakAt: bar.high, sweepExtreme },
      };
    }
    return { invalidated: false };
  };
}
