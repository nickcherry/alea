import { TRAINING_OUTCOME_PROFILE_ID } from "@alea/constants/training";
import type { DatabaseClient } from "@alea/lib/db/types";
import { sql } from "kysely";

export type CommitteeFiringDayRow = {
  readonly filter_id: string;
  readonly filter_version: number;
  readonly config_canon: string;
  readonly period: string;
  readonly market_regime: string;
  readonly day_ms: number;
  readonly n_up: number;
  readonly n_down: number;
};

/**
 * Per-(selected candidate, day) firing counts split by direction.
 *
 * Joins `filter_engagements ⋈ filter_runs ⋈ bar_regimes` the same way
 * `loadCandidateRegimeStats` does, but with the day-bucket instead of
 * quarter-bucket, and restricted to candidates that survived selection
 * (intersect with `committee_selections`). Each row is one
 * (filter_id, filter_version, config_canon, period, market_regime, day)
 * bucket, summed across every asset that contributed engagements in
 * that regime on that day. `day_ms` is midnight-UTC of the bucket.
 */
export async function loadCommitteeFirings({
  db,
}: {
  readonly db: DatabaseClient;
}): Promise<readonly CommitteeFiringDayRow[]> {
  const rows = await sql<{
    filter_id: string;
    filter_version: number;
    config_canon: string;
    period: string;
    market_regime: string;
    day_ms: string;
    n_up: string;
    n_down: string;
  }>`
    select
      fr.filter_id,
      fr.filter_version,
      fr.config_canon,
      fr.period,
      br.market_regime,
      ((fe.ts_ms / 86400000) * 86400000)::bigint::text as day_ms,
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
             br.market_regime, (fe.ts_ms / 86400000)
  `.execute(db);

  return rows.rows.map((r) => ({
    filter_id: r.filter_id,
    filter_version: r.filter_version,
    config_canon: r.config_canon,
    period: r.period,
    market_regime: r.market_regime,
    day_ms: Number(r.day_ms),
    n_up: Number(r.n_up),
    n_down: Number(r.n_down),
  }));
}
