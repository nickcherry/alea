import {
  type AmbiguousTrendBaseConfig,
  type AmbiguousTrendMatch,
  findAmbiguousTrendMatch,
} from "@alea/lib/filters/ambiguousTrendCore";
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

export type AmbiguousTrendConfig = AmbiguousTrendBaseConfig &
  ThesisLifecycleConfig;

export const ambiguousTrendFilter: TradingFilter<AmbiguousTrendConfig> = {
  id: "ambiguous_trend_continuation",
  name: "Ambiguous-Synth Trend Continuation",
  version: 1,
  description:
    "Targets the regime where the synthetic bar at HH:50 is ambiguous (small body and a close-location near the middle of the bar's range) so the synth-direction baseline is weak. In that regime, predicts direction from the prevailing EMA trend: fast EMA above slow EMA with positive slope plus close above the slow EMA votes up, mirror votes down. Lifecycle invalidates on max age, consecutive wrong bars, an unfavorable right-vs-wrong tally, or a close back through the slow EMA against the trend.",
  sources: [pythSpotCandleSource],
  evaluate({ series, config }) {
    const match = findAmbiguousTrendMatch({ bars: series.pyth, config });
    return applyAmbiguousTrendLifecycle({ match, config });
  },
};

export function applyAmbiguousTrendLifecycle({
  match,
  config,
}: {
  readonly match: AmbiguousTrendMatch;
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
    structuralCheck: ambiguousTrendStructuralCheck({
      slowEmaSeries: match.slowEmaSeries,
    }),
  });
  const baseMetadata = match.evaluation.metadata ?? {};
  if (lifecycle.invalidated) {
    return {
      decision: "neutral",
      reason: lifecycle.reason ?? "ambiguous trend invalidated",
      metadata: { ...baseMetadata, ...lifecycle.metadata },
    };
  }
  return {
    ...match.evaluation,
    metadata: { ...baseMetadata, ...lifecycle.metadata },
  };
}

export function ambiguousTrendStructuralCheck({
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
