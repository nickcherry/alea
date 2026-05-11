import type { Candidate, FilterPrediction } from "@alea/lib/filters/types";

/**
 * A single candidate's vote at one decision moment. `null` is
 * abstain (the underlying filter returned null because its trigger
 * conditions weren't met or the bar window was too short).
 */
export type CandidateVote = {
  readonly candidate: Candidate;
  readonly prediction: FilterPrediction;
};

/**
 * The committee's final decision after simple-majority aggregation
 * across every voting candidate. `null` means no actionable signal
 * — either no candidate voted, or up and down ties.
 *
 * `up` / `down` / `abstain` record the tally of all candidates for
 * audit + dashboard analytics.
 */
export type CommitteeDecision = {
  readonly prediction: FilterPrediction;
  readonly up: number;
  readonly down: number;
  readonly abstain: number;
};
