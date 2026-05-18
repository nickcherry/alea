import {
  findRecentStreakReversal,
  type StreakReversalBaseConfig,
  type StreakReversalMatch,
} from "@alea/lib/filters/streakReversalCore";
import {
  runThesisLifecycle,
  type ThesisLifecycleConfig,
} from "@alea/lib/filters/thesisLifecycle";
import {
  type FilterEvaluation,
  pythSpotCandleSource,
  type TradingFilter,
} from "@alea/lib/filters/types";

export type StreakReversalConfig = StreakReversalBaseConfig &
  ThesisLifecycleConfig;

export const streakReversalFilter: TradingFilter<StreakReversalConfig> = {
  id: "streak_reversal",
  name: "Streak Reversal",
  version: 1,
  description:
    "Simplest mean-reversion filter: after N consecutive same-direction closed bars (and a minimum cumulative return), bet the opposite direction on the next candle. Bullish after a down streak, bearish after an up streak. Lifecycle invalidates on max age, consecutive wrong bars, or an unfavorable right-vs-wrong tally.",
  sources: [pythSpotCandleSource],
  evaluate({ series, config }) {
    const match = findRecentStreakReversal({ bars: series.pyth, config });
    return applyStreakReversalLifecycle({ match, config });
  },
};

export function applyStreakReversalLifecycle({
  match,
  config,
}: {
  readonly match: StreakReversalMatch;
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
  });
  const baseMetadata = match.evaluation.metadata ?? {};
  if (lifecycle.invalidated) {
    return {
      decision: "neutral",
      reason: lifecycle.reason ?? "streak reversal invalidated",
      metadata: { ...baseMetadata, ...lifecycle.metadata },
    };
  }
  return {
    ...match.evaluation,
    metadata: { ...baseMetadata, ...lifecycle.metadata },
  };
}
