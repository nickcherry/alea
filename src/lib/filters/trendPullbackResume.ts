import {
  runThesisLifecycle,
  type ThesisLifecycleConfig,
  type ThesisStructuralCheck,
} from "@alea/lib/filters/thesisLifecycle";
import {
  findRecentTrendPullbackResume,
  type TrendPullbackResumeBaseConfig,
  type TrendPullbackResumeMatch,
} from "@alea/lib/filters/trendPullbackResumeCore";
import {
  type FilterEvaluation,
  pythSpotCandleSource,
  type TradingFilter,
} from "@alea/lib/filters/types";

export type TrendPullbackResumeConfig = TrendPullbackResumeBaseConfig &
  ThesisLifecycleConfig;

export const trendPullbackResumeFilter: TradingFilter<TrendPullbackResumeConfig> =
  {
    id: "trend_pullback_resume",
    name: "Trend Pullback Resume",
    version: 1,
    description:
      "Detects a clean trend pullback that fails to damage structure and a current candle that resumes the trend. Bullish trigger: fast EMA above slow EMA with positive slope, close above slow EMA, current candle is green with a strong body and close-location, and the last N pullback candles include at least one red bar while every close stays above the slow EMA. Bearish is the mirror image. While the thesis remains active, the next candles vote in the trend direction until invalidated by age, consecutive wrong bars, an unfavorable right-vs-wrong tally, or a close back through the slow EMA against the trend.",
    sources: [pythSpotCandleSource],
    evaluate({ series, config }) {
      const match = findRecentTrendPullbackResume({
        bars: series.pyth,
        config,
      });
      return applyTrendPullbackResumeLifecycle({ match, config });
    },
  };

export function applyTrendPullbackResumeLifecycle({
  match,
  config,
}: {
  readonly match: TrendPullbackResumeMatch;
  readonly config: ThesisLifecycleConfig;
}): FilterEvaluation {
  if (!match.matched) {
    return match.evaluation;
  }
  const lifecycle = runThesisLifecycle({
    direction: match.trigger.direction,
    confirmedIndex: match.trigger.confirmedIndex,
    bars: match.bars,
    lastIndex: match.lastIndex,
    config,
    structuralCheck: trendPullbackResumeStructuralCheck({
      slowEmaSeries: match.slowEmaSeries,
    }),
  });
  const baseMetadata = match.evaluation.metadata ?? {};
  if (lifecycle.invalidated) {
    return {
      decision: "neutral",
      reason: lifecycle.reason ?? "trend pullback resume invalidated",
      metadata: { ...baseMetadata, ...lifecycle.metadata },
    };
  }
  return {
    ...match.evaluation,
    metadata: { ...baseMetadata, ...lifecycle.metadata },
  };
}

export function trendPullbackResumeStructuralCheck({
  slowEmaSeries,
}: {
  readonly slowEmaSeries: readonly (number | null)[];
}): ThesisStructuralCheck {
  return ({ direction, bar, barIndex }) => {
    const slow = slowEmaSeries[barIndex];
    if (slow == null) {
      return { invalidated: false };
    }
    if (direction === "up" && bar.close < slow) {
      return {
        invalidated: true,
        reason: "price closed back below slow EMA against trend",
        metadata: { slowEma: slow, closedAt: bar.close },
      };
    }
    if (direction === "down" && bar.close > slow) {
      return {
        invalidated: true,
        reason: "price closed back above slow EMA against trend",
        metadata: { slowEma: slow, closedAt: bar.close },
      };
    }
    return { invalidated: false };
  };
}
