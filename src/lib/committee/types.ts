import type { Candidate, FilterPrediction } from "@alea/lib/filters/types";

export type CommitteeSelectionVoteStats = {
  readonly winRate: number | null;
  readonly nEngagements: number | null;
  readonly rank: number | null;
};

export const UNKNOWN_COMMITTEE_SELECTION_VOTE_STATS: CommitteeSelectionVoteStats =
  {
    winRate: null,
    nEngagements: null,
    rank: null,
  };

export type CommitteeCandidate = {
  readonly candidate: Candidate;
  readonly selection: CommitteeSelectionVoteStats;
};

/**
 * A single candidate's vote at one decision moment. `null` is
 * abstain (the underlying filter returned null because its engagement
 * conditions weren't met or the bar window was too short).
 */
export type CandidateVote = {
  readonly candidate: Candidate;
  readonly prediction: FilterPrediction;
  readonly selection: CommitteeSelectionVoteStats;
};

/**
 * The committee's final decision after applying the shared trade
 * decision policy. `null` means no actionable signal — either too few
 * filter-collapsed candidates voted, or consensus was not high enough.
 *
 * `up` / `down` / `abstain` record the tally after at-most-one active
 * vote per filter has been enforced for audit + dashboard analytics.
 */
export type CommitteeDecision = {
  readonly prediction: FilterPrediction;
  readonly up: number;
  readonly down: number;
  readonly abstain: number;
};
