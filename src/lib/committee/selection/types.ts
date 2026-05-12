/**
 * Eligibility + ranking rules for `committee:select`. Tweakable
 * defaults — passed into `runCommitteeSelection` so the CLI can
 * surface them via flags later without touching the library.
 *
 * Rationale for the defaults lives in `doc/COMMITTEE.md`.
 */
export type CommitteeSelectionRules = {
  /** Minimum aggregate engagements in a regime for the candidate to
   * be considered eligible. Below this the WR is too noisy to act
   * on. */
  readonly minEngagements: number;
  /** Floor on the (candidate, regime) aggregate win rate. */
  readonly minAggregateWinRate: number;
  /** Floor on the worst quarter's win rate within this regime. A
   * quarter must have at least `worstQuarterMinEngagements` engagements to enter
   * the floor check; candidates with no quarter large enough skip
   * the check entirely. */
  readonly minWorstQuarterWinRate: number;
  readonly worstQuarterMinEngagements: number;
  /** Top-K cap per (asset, regime, period). */
  readonly topN: number;
};

export const DEFAULT_COMMITTEE_SELECTION_RULES: CommitteeSelectionRules = {
  minEngagements: 80,
  minAggregateWinRate: 0.56,
  minWorstQuarterWinRate: 0.52,
  worstQuarterMinEngagements: 40,
  topN: 6,
};

/** Inputs the ranking sees about a single (candidate, asset, regime). */
export type CandidateRegimeStats = {
  readonly filterId: string;
  readonly filterVersion: number;
  readonly configCanon: string;
  readonly asset: string;
  readonly period: string;
  readonly marketRegime: string;
  readonly nEngagements: number;
  readonly nWins: number;
  readonly winRate: number;
  readonly wilsonLow: number;
  /** Lowest WR across quarters with `≥ worstQuarterMinEngagements` engagements
   * within this regime. `null` when no quarter clears the sample
   * minimum — in that case the worst-quarter floor doesn't apply. */
  readonly worstQuarterWinRate: number | null;
};

export type SelectedCandidate = CandidateRegimeStats & {
  readonly rank: number;
};
