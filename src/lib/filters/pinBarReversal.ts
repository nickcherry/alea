import {
  findRecentPinBarReversal,
  type PinBarReversalBaseConfig,
  type PinBarReversalMatch,
} from "@alea/lib/filters/pinBarReversalCore";
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

export type PinBarReversalConfig = PinBarReversalBaseConfig &
  ThesisLifecycleConfig;

export const pinBarReversalFilter: TradingFilter<PinBarReversalConfig> = {
  id: "pin_bar_reversal",
  name: "Pin Bar Reversal",
  version: 1,
  description:
    "Classic single-bar reversal pattern: a bar that touches a recent N-bar extreme with a large rejection wick (>=minWickPct of range), a small body (<=maxBodyPct of range), and a close back across the body toward the rejection direction. Bullish at recent low with lower wick; bearish at recent high with upper wick. Lifecycle invalidates on max age, consecutive wrong bars, an unfavorable right-vs-wrong tally, or a fresh close beyond the pin's extreme.",
  sources: [pythSpotCandleSource],
  evaluate({ series, config }) {
    const match = findRecentPinBarReversal({ bars: series.pyth, config });
    return applyPinBarReversalLifecycle({ match, config });
  },
};

export function applyPinBarReversalLifecycle({
  match,
  config,
}: {
  readonly match: PinBarReversalMatch;
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
    structuralCheck: pinBarReversalStructuralCheck({
      extremeExtreme: match.trigger.extremeExtreme,
      direction: match.trigger.direction,
    }),
  });
  const baseMetadata = match.evaluation.metadata ?? {};
  if (lifecycle.invalidated) {
    return {
      decision: "neutral",
      reason: lifecycle.reason ?? "pin bar reversal invalidated",
      metadata: { ...baseMetadata, ...lifecycle.metadata },
    };
  }
  return {
    ...match.evaluation,
    metadata: { ...baseMetadata, ...lifecycle.metadata },
  };
}

export function pinBarReversalStructuralCheck({
  extremeExtreme,
  direction,
}: {
  readonly extremeExtreme: number;
  readonly direction: "up" | "down";
}): ThesisStructuralCheck {
  return ({ bar, direction: lifecycleDirection }) => {
    if (lifecycleDirection !== direction) {
      return { invalidated: false };
    }
    if (direction === "up" && bar.close < extremeExtreme) {
      return {
        invalidated: true,
        reason: "close fell below pin bar low after bullish rejection",
        metadata: { extremeExtreme, closedAt: bar.close },
      };
    }
    if (direction === "down" && bar.close > extremeExtreme) {
      return {
        invalidated: true,
        reason: "close rose above pin bar high after bearish rejection",
        metadata: { extremeExtreme, closedAt: bar.close },
      };
    }
    return { invalidated: false };
  };
}
