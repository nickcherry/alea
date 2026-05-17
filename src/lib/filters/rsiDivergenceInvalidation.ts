import type { RsiDivergenceMatch } from "@alea/lib/filters/rsiDivergenceCore";
import type { FilterEvaluation } from "@alea/lib/filters/types";

type MatchedRsiDivergence = Extract<
  RsiDivergenceMatch,
  { readonly matched: true }
>;

type AgreementDirection = "agreement" | "disagreement" | "flat";

export type RsiDivergenceInvalidationResult = {
  readonly invalidated: boolean;
  readonly reason?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
};

export type RsiDivergenceInvalidationConfig = {
  readonly minAgreementScore: number;
  readonly maxConsecutiveDisagreements: number;
};

export const defaultRsiDivergenceInvalidationConfig = {
  minAgreementScore: 0,
  maxConsecutiveDisagreements: 2,
} as const satisfies RsiDivergenceInvalidationConfig;

export function applyRsiDivergenceInvalidation({
  match,
  config,
}: {
  readonly match: RsiDivergenceMatch;
  readonly config: RsiDivergenceInvalidationConfig;
}): FilterEvaluation {
  if (!match.matched) {
    return match.evaluation;
  }
  const invalidation = evaluateRsiDivergenceInvalidation({ match, config });
  if (!invalidation.invalidated) {
    return match.evaluation;
  }
  return {
    decision: "neutral",
    reason: invalidation.reason ?? "RSI divergence invalidated",
    metadata: {
      ...(match.evaluation.metadata ?? {}),
      ...(invalidation.metadata ?? {}),
    },
  };
}

export function evaluateRsiDivergenceInvalidation({
  match,
  config,
}: {
  readonly match: MatchedRsiDivergence;
  readonly config: RsiDivergenceInvalidationConfig;
}): RsiDivergenceInvalidationResult {
  validateRsiDivergenceInvalidationConfig(config);
  let agreementScore = 0;
  let agreementCount = 0;
  let disagreementCount = 0;
  let consecutiveDisagreements = 0;

  for (
    let barIndex = Math.max(0, match.signal.confirmedIndex + 1);
    barIndex <= match.lastIndex;
    barIndex += 1
  ) {
    const bar = match.bars[barIndex];
    if (bar === undefined) {
      continue;
    }
    const direction = agreementDirectionForBar({
      decision: match.decision,
      open: bar.open,
      close: bar.close,
    });
    if (direction === "agreement") {
      agreementScore += 1;
      agreementCount += 1;
      consecutiveDisagreements = 0;
    } else if (direction === "disagreement") {
      agreementScore -= 1;
      disagreementCount += 1;
      consecutiveDisagreements += 1;
    } else {
      consecutiveDisagreements = 0;
    }

    if (agreementScore < config.minAgreementScore) {
      return {
        invalidated: true,
        reason: `RSI divergence invalidated when agreement tally fell below ${config.minAgreementScore}`,
        metadata: invalidationMetadata({
          match,
          invalidation: "negative_agreement_tally",
          barIndex,
          agreementScore,
          agreementCount,
          disagreementCount,
          consecutiveDisagreements,
          config,
        }),
      };
    }
    if (consecutiveDisagreements >= config.maxConsecutiveDisagreements) {
      return {
        invalidated: true,
        reason:
          config.maxConsecutiveDisagreements === 1
            ? "RSI divergence invalidated by one disagreeing candle"
            : `RSI divergence invalidated by ${config.maxConsecutiveDisagreements} consecutive disagreeing candles`,
        metadata: invalidationMetadata({
          match,
          invalidation: "two_consecutive_disagreements",
          barIndex,
          agreementScore,
          agreementCount,
          disagreementCount,
          consecutiveDisagreements,
          config,
        }),
      };
    }
  }

  return {
    invalidated: false,
    metadata: {
      agreementScore,
      agreementCount,
      disagreementCount,
      consecutiveDisagreements,
      minAgreementScore: config.minAgreementScore,
      maxConsecutiveDisagreements: config.maxConsecutiveDisagreements,
    },
  };
}

function agreementDirectionForBar({
  decision,
  open,
  close,
}: {
  readonly decision: MatchedRsiDivergence["decision"];
  readonly open: number;
  readonly close: number;
}): AgreementDirection {
  if (close === open) {
    return "flat";
  }
  if (decision === "up") {
    return close > open ? "agreement" : "disagreement";
  }
  return close < open ? "agreement" : "disagreement";
}

function invalidationMetadata({
  match,
  invalidation,
  barIndex,
  agreementScore,
  agreementCount,
  disagreementCount,
  consecutiveDisagreements,
  config,
}: {
  readonly match: MatchedRsiDivergence;
  readonly invalidation: string;
  readonly barIndex: number;
  readonly agreementScore: number;
  readonly agreementCount: number;
  readonly disagreementCount: number;
  readonly consecutiveDisagreements: number;
  readonly config: RsiDivergenceInvalidationConfig;
}): Readonly<Record<string, unknown>> {
  const bar = match.bars[barIndex];
  return {
    invalidation,
    invalidationIndex: barIndex,
    invalidationOpenTimeMs: bar?.openTimeMs,
    agreementScore,
    agreementCount,
    disagreementCount,
    consecutiveDisagreements,
    minAgreementScore: config.minAgreementScore,
    maxConsecutiveDisagreements: config.maxConsecutiveDisagreements,
  };
}

function validateRsiDivergenceInvalidationConfig(
  config: RsiDivergenceInvalidationConfig,
): void {
  if (!Number.isInteger(config.minAgreementScore)) {
    throw new Error("minAgreementScore must be an integer");
  }
  if (
    !Number.isInteger(config.maxConsecutiveDisagreements) ||
    config.maxConsecutiveDisagreements <= 0
  ) {
    throw new Error("maxConsecutiveDisagreements must be a positive integer");
  }
}
