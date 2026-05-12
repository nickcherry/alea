import type { Database } from "@alea/lib/db/types";
import { type Kysely, sql } from "kysely";

/**
 * The committee's regime-scoped voter roster. Each row says "in
 * regime R, candidate (filter_id, filter_version, config_canon) is
 * one of the top voters at rank K". The dry-run loop (and live
 * trading, once it exists) reads this table at startup and only
 * lets a candidate vote when the classifier's read of the current
 * bar matches the row's `market_regime`.
 *
 * Rows are produced by `bun alea committee:select`, which scans
 * `filter_engagements` × `bar_regimes` and applies the eligibility
 * + ranking rules described in `doc/COMMITTEE.md`. Each run wipes
 * the table and rewrites it — selection is a single snapshot in
 * time, not append-only. `selected_at_ms` records when the snapshot
 * was taken so an operator can tell how stale the live voter roster
 * is.
 *
 * `training_profile` ties the roster back to the outcome-label rule
 * and research window used to select it. Runtime loaders only accept
 * rows for the active profile.
 *
 * `period` is part of the key because a candidate can qualify for
 * 5m but not 15m (or vice versa); the dry-run loop is 5m today but
 * a 15m loop would pull its own roster from the same table.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    create table if not exists committee_selections (
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
    create index if not exists committee_selections_by_regime_period
    on committee_selections (market_regime, period, rank)
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`drop table if exists committee_selections`.execute(db);
}
