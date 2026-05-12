import { TRAINING_PROFILE_ID } from "@alea/constants/training";
import type { DatabaseClient } from "@alea/lib/db/types";
import { activeCandidateRows } from "@alea/lib/filters/activeCandidates";
import { sql } from "kysely";

export type FilterPeerOverlapRow = {
  readonly period: string;
  readonly filterA: string;
  readonly filterB: string;
  readonly jaccard: number;
};

/**
 * Computes the Jaccard similarity of co-engagement for every pair of
 * filter families per period:
 *
 *   J(A, B) = |bars where A engaged ∩ bars where B engaged|
 *             / |bars where A engaged ∪ bars where B engaged|
 *
 * This is filter-family level, not per-config: the union of all of a
 * filter's configs' engagements defines its engagement-bar set.
 */
export async function loadFilterPeerOverlaps({
  db,
}: {
  readonly db: DatabaseClient;
}): Promise<readonly FilterPeerOverlapRow[]> {
  const activeRows = activeCandidateRows();
  if (activeRows.length === 0) {
    return [];
  }
  const activeCandidateValues = sql.join(
    activeRows.map(
      (candidate) =>
        sql`(${candidate.filterId}::text, ${candidate.filterVersion}::integer, ${candidate.configCanon}::text)`,
    ),
  );
  const rows = await sql<{
    period: string;
    filter_a: string;
    filter_b: string;
    shared: string;
    total_a: string;
    total_b: string;
  }>`
    with active_candidates(filter_id, filter_version, config_canon) as (
      values ${activeCandidateValues}
    ),
    filter_engagement_bars as (
      select distinct
        fr.filter_id,
        fr.period,
        fr.asset,
        fe.ts_ms
      from filter_runs fr
      join active_candidates ac
        on ac.filter_id = fr.filter_id
        and ac.filter_version = fr.filter_version
        and ac.config_canon = fr.config_canon
      join filter_engagements fe on fe.run_hash = fr.run_hash
      where fr.training_profile = ${TRAINING_PROFILE_ID}
    ),
    filter_totals as (
      select filter_id, period, count(*) as total
      from filter_engagement_bars
      group by filter_id, period
    ),
    pair_shared as (
      select
        a.filter_id as filter_a,
        b.filter_id as filter_b,
        a.period as period,
        count(*) as shared
      from filter_engagement_bars a
      join filter_engagement_bars b
        on a.period = b.period
        and a.asset = b.asset
        and a.ts_ms = b.ts_ms
       and a.filter_id < b.filter_id
      group by a.filter_id, b.filter_id, a.period
    )
    select
      p.period,
      p.filter_a,
      p.filter_b,
      p.shared::text as shared,
      ta.total::text as total_a,
      tb.total::text as total_b
    from pair_shared p
    join filter_totals ta on ta.filter_id = p.filter_a and ta.period = p.period
    join filter_totals tb on tb.filter_id = p.filter_b and tb.period = p.period
  `.execute(db);

  return rows.rows.map((r) => {
    const shared = Number(r.shared);
    const totalA = Number(r.total_a);
    const totalB = Number(r.total_b);
    const union = totalA + totalB - shared;
    const jaccard = union === 0 ? 0 : shared / union;
    return {
      period: r.period,
      filterA: r.filter_a,
      filterB: r.filter_b,
      jaccard,
    };
  });
}
