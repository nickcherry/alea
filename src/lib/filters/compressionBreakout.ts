import {
  type CompressionBreakoutBaseConfig,
  type CompressionBreakoutMatch,
  findRecentCompressionBreakout,
} from "@alea/lib/filters/compressionBreakoutCore";
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

export type CompressionBreakoutConfig = CompressionBreakoutBaseConfig &
  ThesisLifecycleConfig;

export const compressionBreakoutFilter: TradingFilter<CompressionBreakoutConfig> =
  {
    id: "compression_breakout",
    name: "Compression Breakout",
    version: 1,
    description:
      "Detects a tight compression window (recent average range is materially smaller than the longer baseline average) followed by a current candle that closes outside the compression high/low with a strong body and close-location. Bullish breakout above the compression high votes up; bearish breakdown below the compression low votes down. Lifecycle invalidates on max age, consecutive wrong bars, an unfavorable right-vs-wrong tally, or a close back inside the compression range.",
    sources: [pythSpotCandleSource],
    evaluate({ series, config }) {
      const match = findRecentCompressionBreakout({
        bars: series.pyth,
        config,
      });
      return applyCompressionBreakoutLifecycle({ match, config });
    },
  };

export function applyCompressionBreakoutLifecycle({
  match,
  config,
}: {
  readonly match: CompressionBreakoutMatch;
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
    structuralCheck: compressionBreakoutStructuralCheck({
      compressionHigh: match.trigger.compressionHigh,
      compressionLow: match.trigger.compressionLow,
    }),
  });
  const baseMetadata = match.evaluation.metadata ?? {};
  if (lifecycle.invalidated) {
    return {
      decision: "neutral",
      reason: lifecycle.reason ?? "compression breakout invalidated",
      metadata: { ...baseMetadata, ...lifecycle.metadata },
    };
  }
  return {
    ...match.evaluation,
    metadata: { ...baseMetadata, ...lifecycle.metadata },
  };
}

export function compressionBreakoutStructuralCheck({
  compressionHigh,
  compressionLow,
}: {
  readonly compressionHigh: number;
  readonly compressionLow: number;
}): ThesisStructuralCheck {
  return ({ direction, bar }) => {
    if (
      direction === "up" &&
      bar.close < compressionHigh &&
      bar.close > compressionLow
    ) {
      return {
        invalidated: true,
        reason: "price closed back inside compression range",
        metadata: { compressionHigh, compressionLow, closedAt: bar.close },
      };
    }
    if (
      direction === "down" &&
      bar.close > compressionLow &&
      bar.close < compressionHigh
    ) {
      return {
        invalidated: true,
        reason: "price closed back inside compression range",
        metadata: { compressionHigh, compressionLow, closedAt: bar.close },
      };
    }
    return { invalidated: false };
  };
}
