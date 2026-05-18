import {
  type EmaReversionBaseConfig,
  type EmaReversionMatch,
  findRecentEmaReversion,
} from "@alea/lib/filters/emaReversionCore";
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

export type EmaReversionConfig = EmaReversionBaseConfig & ThesisLifecycleConfig;

export const emaReversionFilter: TradingFilter<EmaReversionConfig> = {
  id: "ema_reversion",
  name: "EMA Distance Reversion",
  version: 1,
  description:
    "Mean-reversion filter: when the current candle's close is at least `minDistancePct` away from its `emaLength`-bar EMA, bet against the extension. Trigger requires a minimum body to avoid firing on noise bars. Bullish when price is stretched far below the EMA; bearish when stretched far above. Lifecycle invalidates on max age, consecutive wrong bars, an unfavorable right-vs-wrong tally, or a close further beyond the trigger extreme.",
  sources: [pythSpotCandleSource],
  evaluate({ series, config }) {
    const match = findRecentEmaReversion({ bars: series.pyth, config });
    return applyEmaReversionLifecycle({ match, config });
  },
};

export function applyEmaReversionLifecycle({
  match,
  config,
}: {
  readonly match: EmaReversionMatch;
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
    structuralCheck: emaReversionStructuralCheck({
      extremeExtreme: match.trigger.extremeExtreme,
      direction: match.trigger.direction,
    }),
  });
  const baseMetadata = match.evaluation.metadata ?? {};
  if (lifecycle.invalidated) {
    return {
      decision: "neutral",
      reason: lifecycle.reason ?? "EMA reversion invalidated",
      metadata: { ...baseMetadata, ...lifecycle.metadata },
    };
  }
  return {
    ...match.evaluation,
    metadata: { ...baseMetadata, ...lifecycle.metadata },
  };
}

export function emaReversionStructuralCheck({
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
    if (direction === "down" && bar.close > extremeExtreme) {
      return {
        invalidated: true,
        reason: "price extended further above trigger high",
        metadata: { extremeExtreme, closedAt: bar.close },
      };
    }
    if (direction === "up" && bar.close < extremeExtreme) {
      return {
        invalidated: true,
        reason: "price extended further below trigger low",
        metadata: { extremeExtreme, closedAt: bar.close },
      };
    }
    return { invalidated: false };
  };
}
