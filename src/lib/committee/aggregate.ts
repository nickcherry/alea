import type {
  CandidateVote,
  CommitteeDecision,
} from "@alea/lib/committee/types";
import type { FilterPrediction } from "@alea/lib/filters/types";

/**
 * Simple-majority committee. Every voting candidate counts as one
 * vote regardless of which filter family it comes from. Strict
 * majority of (up, down) wins; ties and no-votes return `null`
 * (abstain). Abstaining candidates don't enter the denominator.
 *
 * Earlier iterations grouped votes by filter family and ran a
 * two-stage majority (within-family → cross-family). That conflated
 * "filter family" with "regime" — what the user actually wants from
 * "scoped to regime" is **market** regime (low-vol vs high-vol,
 * trending vs ranging), classified separately and attached to each
 * decision for analytics. We do that in `lib/regime/classify` and
 * keep the committee aggregation flat.
 */
export function aggregateCommittee({
  votes,
}: {
  readonly votes: readonly CandidateVote[];
}): CommitteeDecision {
  let up = 0;
  let down = 0;
  let abstain = 0;
  for (const v of votes) {
    if (v.prediction === "up") up += 1;
    else if (v.prediction === "down") down += 1;
    else abstain += 1;
  }
  let prediction: FilterPrediction = null;
  if (up > down) prediction = "up";
  else if (down > up) prediction = "down";
  return { prediction, up, down, abstain };
}
