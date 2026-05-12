import type { Database } from "@alea/lib/db/types";
import { type Kysely, sql } from "kysely";

/**
 * One row per (filter_id, filter_version, config_canon, period,
 * asset) — the unit of cache key for the filter-committee backtest.
 *
 * - `run_hash`: deterministic hex hash of the five identity fields.
 *   Primary key. When a filter's `version` is bumped the hash
 *   changes, so the prior row is orphaned (cheap to GC later).
 * - `config_canon`: canonical JSON stringification of the config
 *   used to compute the hash. Storing it lets us reconstruct what
 *   the hash represents without re-deriving from `config`.
 * - `range_first_ms` / `range_last_ms`: the candle range the row
 *   summarises. If the backtest CLI is asked for the same active
 *   profile and exact window, it skips; otherwise it recomputes.
 * - `n_engagements_*` / `n_wins_*`: aggregate stats. Win rate is
 *   computed in dashboards on the fly.
 *
 * NOTE (May 2026 follow-up): the next migration
 * `202605120000_create_filter_engagements` adds the append-only
 * `filter_engagements` table that carries per-prediction detail.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    create table if not exists filter_runs (
      run_hash text primary key,
      filter_id text not null,
      filter_version integer not null,
      config jsonb not null,
      config_canon text not null,
      period text not null,
      asset text not null,
      range_first_ms bigint not null,
      range_last_ms bigint not null,
      n_bars integer not null,
      n_engagements_up integer not null,
      n_wins_up integer not null,
      n_engagements_down integer not null,
      n_wins_down integer not null,
      computed_at_ms bigint not null,
      constraint filter_runs_period_check check (period in ('5m', '15m')),
      constraint filter_runs_counts_nonneg check (
        n_engagements_up >= 0 and n_wins_up >= 0
        and n_engagements_down >= 0 and n_wins_down >= 0
        and n_wins_up <= n_engagements_up and n_wins_down <= n_engagements_down
      )
    )
  `.execute(db);

  await sql`
    create index if not exists filter_runs_by_filter
    on filter_runs (filter_id, period, asset)
  `.execute(db);

  await sql`
    create index if not exists filter_runs_by_candidate
    on filter_runs (filter_id, filter_version, config_canon)
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`drop table if exists filter_runs`.execute(db);
}
