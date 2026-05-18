import {
  type ExhaustionReversalBaseConfig,
  type ExhaustionReversalMatch,
  findRecentExhaustionReversal,
} from "@alea/lib/filters/exhaustionReversalCore";
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

export type ExhaustionReversalConfig = ExhaustionReversalBaseConfig &
  ThesisLifecycleConfig;

export const exhaustionReversalFilter: TradingFilter<ExhaustionReversalConfig> =
  {
    id: "exhaustion_reversal",
    name: "Exhaustion Reversal",
    version: 1,
    description:
      "Bets against an extended directional run when the current candle shows exhaustion. Bearish trigger: a strong recent up-run (enough green bars over N candles plus positive cumulative return), price extended above its EMA, and the current candle has a tall upper wick, a close in the lower half of its range, and (optionally) a body smaller than the prior bar. Bullish is the mirror image. While the thesis is active, the next candles vote in the reversal direction until invalidated by max age, consecutive wrong bars, an unfavorable right-vs-wrong tally, or a fresh close beyond the exhaustion candle's extreme.",
    sources: [pythSpotCandleSource],
    evaluate({ series, config }) {
      const match = findRecentExhaustionReversal({
        bars: series.pyth,
        config,
      });
      return applyExhaustionReversalLifecycle({ match, config });
    },
  };

export function applyExhaustionReversalLifecycle({
  match,
  config,
}: {
  readonly match: ExhaustionReversalMatch;
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
    structuralCheck: exhaustionReversalStructuralCheck({
      exhaustionExtreme: match.trigger.exhaustionExtreme,
    }),
  });
  const baseMetadata = match.evaluation.metadata ?? {};
  if (lifecycle.invalidated) {
    return {
      decision: "neutral",
      reason: lifecycle.reason ?? "exhaustion reversal invalidated",
      metadata: { ...baseMetadata, ...lifecycle.metadata },
    };
  }
  return {
    ...match.evaluation,
    metadata: { ...baseMetadata, ...lifecycle.metadata },
  };
}

export function exhaustionReversalStructuralCheck({
  exhaustionExtreme,
}: {
  readonly exhaustionExtreme: number;
}): ThesisStructuralCheck {
  return ({ direction, bar }) => {
    if (direction === "down" && bar.close > exhaustionExtreme) {
      return {
        invalidated: true,
        reason: "price closed above exhaustion high",
        metadata: { exhaustionExtreme, closedAt: bar.close },
      };
    }
    if (direction === "up" && bar.close < exhaustionExtreme) {
      return {
        invalidated: true,
        reason: "price closed below exhaustion low",
        metadata: { exhaustionExtreme, closedAt: bar.close },
      };
    }
    return { invalidated: false };
  };
}
