import { aggregateCommittee } from "@alea/lib/committee/aggregate";
import type {
  CandidateVote,
  CommitteeDecision,
} from "@alea/lib/committee/types";
import "@alea/lib/filters/all";
import { allCandidates, getFilter } from "@alea/lib/filters/registry";
import type { Candidate, FilterBar } from "@alea/lib/filters/types";

/**
 * The committee is just every currently-registered candidate. We
 * pruned the registry to the top-5 configs per filter and dropped
 * <50% filters in the backtest, so "every candidate" is the right
 * set. A future iteration can plug a selector here (e.g. only
 * candidates whose stratified backtest win rate clears a Wilson-CI
 * bound in the current market regime).
 */
export function listCommitteeCandidates(): readonly Candidate[] {
  return allCandidates();
}

/**
 * Evaluate the committee on a bar window. Each registered
 * candidate's `predict` runs on the same window; their votes are
 * collected and passed to `aggregateCommittee`. Bars too short to
 * meet a filter's `requiredBars` are treated as abstain.
 */
export function evaluateCommittee({
  bars,
  candidates,
}: {
  readonly bars: readonly FilterBar[];
  readonly candidates?: readonly Candidate[];
}): {
  readonly decision: CommitteeDecision;
  readonly votes: readonly CandidateVote[];
} {
  const list = candidates ?? listCommitteeCandidates();
  const votes: CandidateVote[] = [];
  for (const cand of list) {
    const entry = getFilter(cand.filterId);
    if (entry === undefined) continue;
    const need = entry.filter.requiredBars(cand.config as never);
    let prediction = null as ReturnType<typeof entry.filter.predict>;
    if (bars.length >= need) {
      // Pass only the trailing `need` bars so the filter sees what
      // it'd see in a real backtest.
      const slice = bars.slice(bars.length - need);
      prediction = entry.filter.predict(cand.config as never, slice);
    }
    votes.push({ candidate: cand, prediction });
  }
  const decision = aggregateCommittee({ votes });
  return { decision, votes };
}
