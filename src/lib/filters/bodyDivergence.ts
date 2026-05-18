import {
  type BodyDivergenceBaseConfig,
  type BodyDivergenceMatch,
  findRecentBodyDivergence,
} from "@alea/lib/filters/bodyDivergenceCore";
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

export type BodyDivergenceConfig = BodyDivergenceBaseConfig &
  ThesisLifecycleConfig;

export const bodyDivergenceFilter: TradingFilter<BodyDivergenceConfig> = {
  id: "body_divergence",
  name: "Body Divergence",
  version: 1,
  description:
    "Divergence cousin that compares bar bodies (|close - open|) at consecutive same-direction pivots. Bullish: confirmed swing-low prints a lower low than the prior pivot, but its body shrunk by at least the configured fraction — momentum into the new low is fading. Bearish is the mirror at swing highs. Lifecycle invalidates on max age, consecutive wrong bars, an unfavorable right-vs-wrong tally, or a fresh close beyond the current pivot extreme.",
  sources: [pythSpotCandleSource],
  evaluate({ series, config }) {
    const match = findRecentBodyDivergence({ bars: series.pyth, config });
    return applyBodyDivergenceLifecycle({ match, config });
  },
};

export function applyBodyDivergenceLifecycle({
  match,
  config,
}: {
  readonly match: BodyDivergenceMatch;
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
    structuralCheck: bodyDivergenceStructuralCheck({
      pivotExtreme: match.trigger.pivotExtreme,
      direction: match.trigger.direction,
    }),
  });
  const baseMetadata = match.evaluation.metadata ?? {};
  if (lifecycle.invalidated) {
    return {
      decision: "neutral",
      reason: lifecycle.reason ?? "body divergence invalidated",
      metadata: { ...baseMetadata, ...lifecycle.metadata },
    };
  }
  return {
    ...match.evaluation,
    metadata: { ...baseMetadata, ...lifecycle.metadata },
  };
}

export function bodyDivergenceStructuralCheck({
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
