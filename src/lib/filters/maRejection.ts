import {
  findRecentMaRejection,
  type MaRejectionBaseConfig,
  type MaRejectionMatch,
} from "@alea/lib/filters/maRejectionCore";
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

export type MaRejectionConfig = MaRejectionBaseConfig & ThesisLifecycleConfig;

export const maRejectionFilter: TradingFilter<MaRejectionConfig> = {
  id: "ma_rejection",
  name: "Moving-Average Rejection",
  version: 1,
  description:
    "Detects a trend-aligned rejection at a moving average. Bullish trigger: fast EMA > mid EMA > slow EMA (uptrend stack), the current bar's low pierces the fast or mid EMA from above, the close back above the fast EMA shows a strong lower wick and close-location. Bearish is the mirror image at the trend stack inverted. Lifecycle invalidates on max age, consecutive wrong bars, an unfavorable right-vs-wrong tally, or a close back through the fast EMA against the trend.",
  sources: [pythSpotCandleSource],
  evaluate({ series, config }) {
    const match = findRecentMaRejection({ bars: series.pyth, config });
    return applyMaRejectionLifecycle({ match, config });
  },
};

export function applyMaRejectionLifecycle({
  match,
  config,
}: {
  readonly match: MaRejectionMatch;
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
    structuralCheck: maRejectionStructuralCheck({
      fastEmaSeries: match.fastEmaSeries,
    }),
  });
  const baseMetadata = match.evaluation.metadata ?? {};
  if (lifecycle.invalidated) {
    return {
      decision: "neutral",
      reason: lifecycle.reason ?? "MA rejection invalidated",
      metadata: { ...baseMetadata, ...lifecycle.metadata },
    };
  }
  return {
    ...match.evaluation,
    metadata: { ...baseMetadata, ...lifecycle.metadata },
  };
}

export function maRejectionStructuralCheck({
  fastEmaSeries,
}: {
  readonly fastEmaSeries: readonly (number | null)[];
}): ThesisStructuralCheck {
  return ({ direction, bar, barIndex }) => {
    const fast = fastEmaSeries[barIndex];
    if (fast == null) {
      return { invalidated: false };
    }
    if (direction === "up" && bar.close < fast) {
      return {
        invalidated: true,
        reason: "price closed back below fast EMA against trend",
        metadata: { fastEma: fast, closedAt: bar.close },
      };
    }
    if (direction === "down" && bar.close > fast) {
      return {
        invalidated: true,
        reason: "price closed back above fast EMA against trend",
        metadata: { fastEma: fast, closedAt: bar.close },
      };
    }
    return { invalidated: false };
  };
}
