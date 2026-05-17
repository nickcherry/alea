import { tradeCandidatesForMarket } from "@alea/lib/filters/registry";
import type {
  CandidateTradeDecision,
  CandidateVote,
  FilterCandidate,
  FilterEvaluationContext,
} from "@alea/lib/filters/types";

export function evaluateCandidateTradeDecision({
  context,
  candidates,
}: {
  readonly context: FilterEvaluationContext;
  readonly candidates?: readonly FilterCandidate[];
}): CandidateTradeDecision {
  const selectedCandidates =
    candidates ??
    tradeCandidatesForMarket({
      asset: context.asset,
      period: context.period,
    });
  const votes: CandidateVote[] = selectedCandidates.map((candidate) => {
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
  const decision =
    up > 0 && down === 0 ? "up" : down > 0 && up === 0 ? "down" : "neutral";
  const prediction = decision === "up" ? "u" : decision === "down" ? "d" : null;
  const summaryPrefix =
    up > 0 && down > 0 ? "trade filters conflict" : "trade filters";
  return {
    decision,
    prediction,
    up,
    down,
    neutral,
    votes,
    summary: `${summaryPrefix} up=${up} down=${down} neutral=${neutral}`,
  };
}
