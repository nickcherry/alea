import type { Database } from "@alea/lib/db/types";
import { type Kysely, sql } from "kysely";

/**
 * Rebuild derived training tables so the persisted aggregate counters use
 * engagement terminology end-to-end. This intentionally drops only derived
 * training/selection state; canonical candles and captured market data are
 * untouched and can repopulate these tables via training/regime/committee
 * commands.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`drop table if exists committee_selections`.execute(db);
  await sql`drop table if exists filter_engagements`.execute(db);
  await sql`drop table if exists filter_runs`.execute(db);

  await sql`
    create table filter_runs (
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
    create index filter_runs_by_filter
    on filter_runs (filter_id, period, asset)
  `.execute(db);
  await sql`
    create index filter_runs_by_candidate
    on filter_runs (filter_id, filter_version, config_canon)
  `.execute(db);

  await sql`
    create table filter_engagements (
      run_hash text not null,
      ts_ms bigint not null,
      direction char(1) not null,
      won smallint not null,
      primary key (run_hash, ts_ms),
      constraint filter_engagements_direction check (direction in ('u', 'd')),
      constraint filter_engagements_won check (won in (0, 1))
    )
  `.execute(db);

  await sql`
    create table committee_selections (
      training_profile text not null,
      market_regime text not null,
      period text not null,
      filter_id text not null,
      filter_version integer not null,
      config_canon text not null,
      rank integer not null,
      n_engagements integer not null,
      n_wins integer not null,
      win_rate double precision not null,
      wilson_low double precision not null,
      worst_quarter_wr double precision,
      selected_at_ms bigint not null,
      primary key (market_regime, period, filter_id, filter_version, config_canon),
      constraint committee_selections_regime check (
        market_regime in (
          'low_vol_trending',
          'low_vol_ranging',
          'high_vol_trending',
          'high_vol_ranging'
        )
      ),
      constraint committee_selections_period check (period in ('5m', '15m'))
    )
  `.execute(db);
  await sql`
    create index committee_selections_by_regime_period
    on committee_selections (market_regime, period, rank)
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`drop table if exists committee_selections`.execute(db);
  await sql`drop table if exists filter_engagements`.execute(db);
  await sql`drop table if exists filter_runs`.execute(db);
}
