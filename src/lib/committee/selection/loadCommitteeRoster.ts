import type { DatabaseClient } from "@alea/lib/db/types";

/**
 * Voter roster used by the dry-run loop (and live trading, when it
 * exists). Maps `(market_regime, period)` to the selected candidate
 * keys and their selection stats in that bucket — and `selectedAtMs`
 * so the caller can warn when the roster is dramatically stale.
 *
 * The candidate key is `filterId|filterVersion|configCanon`, the
 * same shape used inside the dry-run/live evaluator so a candidate
 * lookup is a single map hit instead of a property match.
 */
export type CommitteeRoster = {
  readonly selectedAtMs: number | null;
  readonly byBucket: ReadonlyMap<string, readonly CommitteeRosterMember[]>;
};

export type CommitteeRosterMember = {
  readonly key: string;
  readonly winRate: number;
  readonly nEngagements: number;
  readonly rank: number;
};

export function rosterBucketKey({
  marketRegime,
  period,
}: {
  readonly marketRegime: string;
  readonly period: string;
}): string {
  return `${marketRegime}|${period}`;
}

export function candidateRosterKey({
  filterId,
  filterVersion,
  configCanon,
}: {
  readonly filterId: string;
  readonly filterVersion: number;
  readonly configCanon: string;
}): string {
  return `${filterId}|${filterVersion}|${configCanon}`;
}

/**
 * Loads every row in `committee_selections` and folds it into a
 * single in-memory roster. Cheap (a few hundred rows in practice)
 * so it's safe to call once per process startup.
 */
export async function loadCommitteeRoster({
  db,
}: {
  readonly db: DatabaseClient;
}): Promise<CommitteeRoster> {
  const rows = await db
    .selectFrom("committee_selections")
    .select([
      "market_regime",
      "period",
      "filter_id",
      "filter_version",
      "config_canon",
      "rank",
      "n_engagements",
      "win_rate",
      "selected_at_ms",
    ])
    .execute();
  const byBucket = new Map<string, CommitteeRosterMember[]>();
  let selectedAtMs: number | null = null;
  for (const r of rows) {
    const bucket = rosterBucketKey({
      marketRegime: r.market_regime,
      period: r.period,
    });
    let members = byBucket.get(bucket);
    if (members === undefined) {
      members = [];
      byBucket.set(bucket, members);
    }
    members.push({
      key: candidateRosterKey({
        filterId: r.filter_id,
        filterVersion: r.filter_version,
        configCanon: r.config_canon,
      }),
      winRate: r.win_rate,
      nEngagements: r.n_engagements,
      rank: r.rank,
    });
    const t = Number(r.selected_at_ms);
    if (selectedAtMs === null || t > selectedAtMs) {
      selectedAtMs = t;
    }
  }
  return { selectedAtMs, byBucket };
}
