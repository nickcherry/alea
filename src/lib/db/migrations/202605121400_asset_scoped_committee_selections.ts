import type { Database } from "@alea/lib/db/types";
import { type Kysely, sql } from "kysely";

/**
 * Committee selection is derived state. Rebuild it as an asset-scoped roster
 * instead of preserving the old period/regime snapshot shape.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`drop table if exists committee_selections`.execute(db);
  await sql`
    create table committee_selections (
      training_profile text not null,
      asset text not null,
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
      primary key (
        asset,
        market_regime,
        period,
        filter_id,
        filter_version,
        config_canon
      ),
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
    create index committee_selections_by_asset_regime_period
    on committee_selections (asset, market_regime, period, rank)
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`drop table if exists committee_selections`.execute(db);
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
