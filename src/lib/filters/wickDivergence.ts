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
import {
  findRecentWickDivergence,
  type WickDivergenceBaseConfig,
  type WickDivergenceMatch,
} from "@alea/lib/filters/wickDivergenceCore";

export type WickDivergenceConfig = WickDivergenceBaseConfig &
  ThesisLifecycleConfig;

export const wickDivergenceFilter: TradingFilter<WickDivergenceConfig> = {
  id: "wick_divergence",
  name: "Wick Divergence",
  version: 1,
  description:
    "RSI-divergence cousin that replaces RSI with a single-bar wick measure. Bullish: a confirmed swing-low bar prints a lower low than the prior swing low, but its lower wick (as a fraction of bar range) is larger and optionally its close-location is stronger — buyers reacted harder at the new low. Bearish is the mirror at swing highs with upper wicks. Lifecycle invalidates on max age, consecutive wrong bars, an unfavorable right-vs-wrong tally, or a fresh close beyond the current pivot extreme.",
  sources: [pythSpotCandleSource],
  evaluate({ series, config }) {
    const match = findRecentWickDivergence({ bars: series.pyth, config });
    return applyWickDivergenceLifecycle({ match, config });
  },
};

export function applyWickDivergenceLifecycle({
  match,
  config,
}: {
  readonly match: WickDivergenceMatch;
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
    structuralCheck: wickDivergenceStructuralCheck({
      pivotExtreme: match.trigger.pivotExtreme,
      direction: match.trigger.direction,
    }),
  });
  const baseMetadata = match.evaluation.metadata ?? {};
  if (lifecycle.invalidated) {
    return {
      decision: "neutral",
      reason: lifecycle.reason ?? "wick divergence invalidated",
      metadata: { ...baseMetadata, ...lifecycle.metadata },
    };
  }
  return {
    ...match.evaluation,
    metadata: { ...baseMetadata, ...lifecycle.metadata },
  };
}

export function wickDivergenceStructuralCheck({
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
