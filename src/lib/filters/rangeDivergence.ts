import {
  findRecentRangeDivergence,
  type RangeDivergenceBaseConfig,
  type RangeDivergenceMatch,
} from "@alea/lib/filters/rangeDivergenceCore";
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

export type RangeDivergenceConfig = RangeDivergenceBaseConfig &
  ThesisLifecycleConfig;

export const rangeDivergenceFilter: TradingFilter<RangeDivergenceConfig> = {
  id: "range_divergence",
  name: "Range Divergence",
  version: 1,
  description:
    "Divergence cousin that compares bar ranges at consecutive same-direction pivots. Bullish: a confirmed swing-low prints a lower low than the prior swing low, but the bar's range (high - low) shrunk by at least the configured fraction relative to the prior pivot — selling momentum is fading even though price made a new low. Bearish is the mirror. Optionally also requires the body to shrink. Lifecycle invalidates on max age, consecutive wrong bars, an unfavorable right-vs-wrong tally, or a fresh close beyond the current pivot extreme.",
  sources: [pythSpotCandleSource],
  evaluate({ series, config }) {
    const match = findRecentRangeDivergence({ bars: series.pyth, config });
    return applyRangeDivergenceLifecycle({ match, config });
  },
};

export function applyRangeDivergenceLifecycle({
  match,
  config,
}: {
  readonly match: RangeDivergenceMatch;
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
    structuralCheck: rangeDivergenceStructuralCheck({
      pivotExtreme: match.trigger.pivotExtreme,
      direction: match.trigger.direction,
    }),
  });
  const baseMetadata = match.evaluation.metadata ?? {};
  if (lifecycle.invalidated) {
    return {
      decision: "neutral",
      reason: lifecycle.reason ?? "range divergence invalidated",
      metadata: { ...baseMetadata, ...lifecycle.metadata },
    };
  }
  return {
    ...match.evaluation,
    metadata: { ...baseMetadata, ...lifecycle.metadata },
  };
}

export function rangeDivergenceStructuralCheck({
  pivotExtreme,
  direction,
}: {
  readonly pivotExtreme: number;
  readonly direction: "up" | "down";
}): ThesisStructuralCheck {
  return ({ bar, direction: lifecycleDirection }) => {
    if (lifecycleDirection !== direction) {
      return { invalidated: false };
    }
    if (direction === "up" && bar.close < pivotExtreme) {
      return {
        invalidated: true,
        reason: "close fell below pivot low against bullish divergence",
        metadata: { pivotExtreme, closedAt: bar.close },
      };
    }
    if (direction === "down" && bar.close > pivotExtreme) {
      return {
        invalidated: true,
        reason: "close rose above pivot high against bearish divergence",
        metadata: { pivotExtreme, closedAt: bar.close },
      };
    }
    return { invalidated: false };
  };
}
