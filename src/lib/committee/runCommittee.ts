import "@alea/lib/filters/all";

import {
  type CommitteeDecisionRules,
  DEFAULT_COMMITTEE_DECISION_RULES,
} from "@alea/constants/tradeDecision";
import { aggregateCommittee } from "@alea/lib/committee/aggregate";
import {
  type CandidateVote,
  type CommitteeCandidate,
  type CommitteeDecision,
  UNKNOWN_COMMITTEE_SELECTION_VOTE_STATS,
} from "@alea/lib/committee/types";
import { allCandidates, getFilter } from "@alea/lib/filters/registry";
import type { Candidate, FilterBar } from "@alea/lib/filters/types";

/**
 * Registry inventory. The active dry-run committee is the
 * asset/regime-scoped roster persisted in `committee_selections`; callers
 * pass that selected candidate list into `evaluateCommittee`. The full
 * registry is only used to hydrate persisted roster rows back into runnable
 * filter configs.
 */
export function listCommitteeCandidates(): readonly Candidate[] {
  return allCandidates();
}

/**
 * Evaluate a candidate roster on a bar window. Each candidate's
 * `predict` runs on the same window; votes are collected and passed
 * to `aggregateCommittee`. Bars too short to meet a filter's
 * `requiredBars` are treated as abstain.
 */
export function evaluateCommittee({
  bars,
  candidates,
  decisionRules = DEFAULT_COMMITTEE_DECISION_RULES,
}: {
  readonly bars: readonly FilterBar[];
  readonly candidates: readonly (Candidate | CommitteeCandidate)[];
  readonly decisionRules?: CommitteeDecisionRules;
}): {
  readonly decision: CommitteeDecision;
  readonly votes: readonly CandidateVote[];
} {
  const votes: CandidateVote[] = [];
  for (const raw of candidates) {
    const voter = normalizeCommitteeCandidate({ value: raw });
    const cand = voter.candidate;
    const entry = getFilter(cand.filterId);
    if (entry === undefined) {
      continue;
    }
    const need = entry.filter.requiredBars(cand.config);
    let prediction = null as ReturnType<typeof entry.filter.predict>;
    if (bars.length >= need) {
      // Pass only the trailing `need` bars so the filter sees what
      // it'd see in training, replay, or live evaluation.
      const slice = bars.slice(bars.length - need);
      prediction = entry.filter.predict(cand.config, slice);
    }
    votes.push({ candidate: cand, prediction, selection: voter.selection });
  }
  const decision = aggregateCommittee({ votes, rules: decisionRules });
  return { decision, votes };
}

function normalizeCommitteeCandidate({
  value,
}: {
  readonly value: Candidate | CommitteeCandidate;
}): CommitteeCandidate {
  if ("candidate" in value) {
    return value;
  }
  return {
    candidate: value,
    selection: UNKNOWN_COMMITTEE_SELECTION_VOTE_STATS,
  };
}
