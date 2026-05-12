import {
  candidateRosterKey,
  type CommitteeRoster,
  type CommitteeRosterMember,
  rosterBucketKey,
} from "@alea/lib/committee/selection/loadCommitteeRoster";
import type { SelectedCandidate } from "@alea/lib/committee/selection/types";

export function buildCommitteeRosterFromSelections({
  selections,
  selectedAtMs = null,
}: {
  readonly selections: readonly SelectedCandidate[];
  readonly selectedAtMs?: number | null;
}): CommitteeRoster {
  const byBucket = new Map<string, CommitteeRosterMember[]>();
  for (const selection of selections) {
    const bucket = rosterBucketKey({
      marketRegime: selection.marketRegime,
      period: selection.period,
    });
    const members = byBucket.get(bucket) ?? [];
    members.push({
      key: candidateRosterKey({
        filterId: selection.filterId,
        filterVersion: selection.filterVersion,
        configCanon: selection.configCanon,
      }),
      winRate: selection.winRate,
      nEngagements: selection.nEngagements,
      rank: selection.rank,
    });
    byBucket.set(bucket, members);
  }
  return { selectedAtMs, byBucket };
}
