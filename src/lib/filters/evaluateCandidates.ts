import { registeredCandidates } from "@alea/lib/filters/registry";
import type {
  CandidateTradeDecision,
  CandidateVote,
  FilterCandidate,
  FilterEvaluationContext,
} from "@alea/lib/filters/types";

export function evaluateCandidateTradeDecision({
  context,
  candidates = registeredCandidates,
}: {
  readonly context: FilterEvaluationContext;
  readonly candidates?: readonly FilterCandidate[];
}): CandidateTradeDecision {
  const votes: CandidateVote[] = candidates.map((candidate) => {
    const evaluation = candidate.evaluate(context);
    return {
      candidateId: candidate.id,
      filterId: candidate.filterId,
      filterName: candidate.filterName,
      filterVersion: candidate.filterVersion,
      configHash: candidate.configHash,
      decision: evaluation.decision,
      reason: evaluation.reason ?? null,
    };
  });
  const up = votes.filter((vote) => vote.decision === "up").length;
  const down = votes.filter((vote) => vote.decision === "down").length;
  const neutral = votes.length - up - down;
  const decision = up > down ? "up" : down > up ? "down" : "neutral";
  const prediction = decision === "up" ? "u" : decision === "down" ? "d" : null;
  return {
    decision,
    prediction,
    up,
    down,
    neutral,
    votes,
    summary: `filters up=${up} down=${down} neutral=${neutral}`,
  };
}
