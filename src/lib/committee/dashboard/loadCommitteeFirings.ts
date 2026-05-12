import { TRAINING_OUTCOME_PROFILE_ID } from "@alea/constants/training";
import type { DatabaseClient } from "@alea/lib/db/types";
import { sql } from "kysely";

const WEEK_MS = 7 * 86400000;

export type CommitteeFiringBucketRow = {
  readonly filter_id: string;
  readonly filter_version: number;
  readonly config_canon: string;
  readonly period: string;
  readonly market_regime: string;
  readonly bucket_ms: number;
  readonly n_up: number;
  readonly n_down: number;
};

/**
 * Per-(selected candidate, weekly bucket) firing counts split by
 * direction.
 *
 * Joins `filter_engagements ⋈ filter_runs ⋈ bar_regimes` the same way
 * `loadCandidateRegimeStats` does, but bucketed by 7-day windows
 * (aligned to the Unix epoch), and restricted to candidates that
 * survived selection (intersect with `committee_selections`). Each row
 * is one (filter, period, regime, week) bucket, summed across every
 * asset that contributed engagements in that regime that week.
 *
 * Weekly granularity is chosen so the dashboard chart can render each
 * bucket as a visibly-wide cell — daily buckets at 3-year scale
 * compress to ~1px each and the eye can't separate cells.
 */
export async function loadCommitteeFirings({
  db,
}: {
  readonly db: DatabaseClient;
}): Promise<readonly CommitteeFiringBucketRow[]> {
  const rows = await sql<{
    filter_id: string;
    filter_version: number;
    config_canon: string;
    period: string;
    market_regime: string;
    bucket_ms: string;
    n_up: string;
    n_down: string;
  }>`
    select
      fr.filter_id,
      fr.filter_version,
      fr.config_canon,
      fr.period,
      br.market_regime,
      ((fe.ts_ms / 604800000) * 604800000)::bigint::text as bucket_ms,
      sum(case when fe.direction = 'u' then 1 else 0 end)::text as n_up,
      sum(case when fe.direction = 'd' then 1 else 0 end)::text as n_down
    from filter_engagements fe
    join filter_runs fr on fr.run_hash = fe.run_hash
    join bar_regimes br
      on br.asset = fr.asset
      and br.period = fr.period
      and br.ts_ms = fe.ts_ms
    join committee_selections cs
      on cs.filter_id = fr.filter_id
      and cs.filter_version = fr.filter_version
      and cs.config_canon = fr.config_canon
      and cs.period = fr.period
      and cs.market_regime = br.market_regime
    where br.market_regime is not null
      and fr.training_profile = ${TRAINING_OUTCOME_PROFILE_ID}
    group by fr.filter_id, fr.filter_version, fr.config_canon, fr.period,
             br.market_regime, (fe.ts_ms / 604800000)
  `.execute(db);

  return rows.rows.map((r) => ({
    filter_id: r.filter_id,
    filter_version: r.filter_version,
    config_canon: r.config_canon,
    period: r.period,
    market_regime: r.market_regime,
    bucket_ms: Number(r.bucket_ms),
    n_up: Number(r.n_up),
    n_down: Number(r.n_down),
  }));
}
