import {
  MAX_COMMITTEE_VOTES_PER_FILTER,
  MIN_COMMITTEE_CONSENSUS_FRACTION,
  MIN_COMMITTEE_VOTES_TO_TRADE,
} from "@alea/constants/tradeDecision";
import type {
  CandidateVote,
  CommitteeDecision,
} from "@alea/lib/committee/types";
import type { FilterPrediction } from "@alea/lib/filters/types";

/**
 * Shared trade-decision vote policy. Multiple selected configs for
 * one filter are all evaluated, but only one active vote per filter
 * can reach the final tally. When several configs of the same filter
 * engage, the one with the strongest selected-regime win rate wins
 * the filter slot.
 *
 * After that filter collapse, the winning side must clear the
 * centralized minimum-vote and consensus constants. With the current
 * constants this is simple majority, with ties and all-abstain
 * returning `null`.
 */
export function aggregateCommittee({
  votes,
}: {
  readonly votes: readonly CandidateVote[];
}): CommitteeDecision {
  const tallies = tallyEffectiveVotes({ votes });
  const prediction = resolvePrediction({ up: tallies.up, down: tallies.down });
  return { prediction, ...tallies };
}

function tallyEffectiveVotes({
  votes,
}: {
  readonly votes: readonly CandidateVote[];
}): Omit<CommitteeDecision, "prediction"> {
  const byFilterId = selectEffectiveVotesByFilter({ votes });
  let up = 0;
  let down = 0;
  let abstain = 0;
  for (const list of byFilterId.values()) {
    if (list.length === 0) {
      abstain += 1;
      continue;
    }
    for (const v of list) {
      if (v.prediction === "up") {
        up += 1;
      } else if (v.prediction === "down") {
        down += 1;
      }
    }
  }
  return { up, down, abstain };
}

function selectEffectiveVotesByFilter({
  votes,
}: {
  readonly votes: readonly CandidateVote[];
}): ReadonlyMap<string, readonly CandidateVote[]> {
  const byFilterId = new Map<string, CandidateVote[]>();
  for (const vote of votes) {
    const filterId = vote.candidate.filterId;
    let selected = byFilterId.get(filterId);
    if (selected === undefined) {
      selected = [];
      byFilterId.set(filterId, selected);
    }
    if (vote.prediction !== null) {
      selected.push(vote);
    }
  }
  for (const [filterId, selected] of byFilterId) {
    if (selected.length <= MAX_COMMITTEE_VOTES_PER_FILTER) {
      continue;
    }
    selected.sort(compareFilterVotes);
    byFilterId.set(filterId, selected.slice(0, MAX_COMMITTEE_VOTES_PER_FILTER));
  }
  return byFilterId;
}

function compareFilterVotes(a: CandidateVote, b: CandidateVote): number {
  const aWinRate = a.selection.winRate ?? Number.NEGATIVE_INFINITY;
  const bWinRate = b.selection.winRate ?? Number.NEGATIVE_INFINITY;
  if (aWinRate !== bWinRate) {
    return bWinRate - aWinRate;
  }

  const aEngagements = a.selection.nEngagements ?? Number.NEGATIVE_INFINITY;
  const bEngagements = b.selection.nEngagements ?? Number.NEGATIVE_INFINITY;
  if (aEngagements !== bEngagements) {
    return bEngagements - aEngagements;
  }

  const aRank = a.selection.rank ?? Number.POSITIVE_INFINITY;
  const bRank = b.selection.rank ?? Number.POSITIVE_INFINITY;
  return aRank - bRank;
}

function resolvePrediction({
  up,
  down,
}: {
  readonly up: number;
  readonly down: number;
}): FilterPrediction {
  const nonAbstain = up + down;
  if (nonAbstain < MIN_COMMITTEE_VOTES_TO_TRADE) {
    return null;
  }
  if (up === down) {
    return null;
  }

  const prediction = up > down ? "up" : "down";
  const winningVotes = Math.max(up, down);
  const consensus = winningVotes / nonAbstain;
  if (consensus < MIN_COMMITTEE_CONSENSUS_FRACTION) {
    return null;
  }
  return prediction;
}
