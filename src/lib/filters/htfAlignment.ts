import {
  findRecentHtfAlignment,
  type HtfAlignmentBaseConfig,
  type HtfAlignmentMatch,
} from "@alea/lib/filters/htfAlignmentCore";
import {
  runThesisLifecycle,
  type ThesisLifecycleConfig,
} from "@alea/lib/filters/thesisLifecycle";
import {
  type FilterEvaluation,
  pythSpotCandleSource,
  type TradingFilter,
} from "@alea/lib/filters/types";

export type HtfAlignmentConfig = HtfAlignmentBaseConfig & ThesisLifecycleConfig;

export const htfAlignmentFilter: TradingFilter<HtfAlignmentConfig> = {
  id: "htf_alignment",
  name: "Higher-Timeframe Alignment",
  version: 1,
  description:
    "Bets in the direction of a multi-bar cumulative return, treating the last N 1h bars as a higher-timeframe trend proxy. Trigger: |close[i] - open[i-N]| / open[i-N] >= minReturnPct. Optionally requires the synthetic bar's intra-hour direction to align with the multi-bar return. Lifecycle invalidates on max age, consecutive wrong bars, or an unfavorable right-vs-wrong tally.",
  sources: [pythSpotCandleSource],
  evaluate({ series, config }) {
    const match = findRecentHtfAlignment({ bars: series.pyth, config });
    return applyHtfAlignmentLifecycle({ match, config });
  },
};

export function applyHtfAlignmentLifecycle({
  match,
  config,
}: {
  readonly match: HtfAlignmentMatch;
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
      reason: lifecycle.reason ?? "htf alignment invalidated",
      metadata: { ...baseMetadata, ...lifecycle.metadata },
    };
  }
  return {
    ...match.evaluation,
    metadata: { ...baseMetadata, ...lifecycle.metadata },
  };
}
