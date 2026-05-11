import type { Database } from "@alea/lib/db/types";
import { type Kysely, sql } from "kysely";

/**
 * One row per resolved Polymarket up/down market we've fetched from the
 * gamma-api. The composite key is `(asset, timeframe, window_start_ts_ms)`
 * — the same shape we'd derive the slug from. The captured `outcome`
 * is "up" when Polymarket's Chainlink settlement reported the window
 * closing flat-or-up, "down" otherwise; "void" preserves rare disputed
 * / refunded markets so we don't re-fetch them every sync.
 *
 * `condition_id` is kept for cross-referencing the gamma row; everything
 * else needed for the proxy-accuracy dashboard (Pyth side) lives in the
 * existing `candles` table.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    create table if not exists polymarket_resolutions (
      asset text not null,
      timeframe text not null,
      window_start_ts_ms bigint not null,
      condition_id text not null,
      outcome text not null,
      uma_status text not null,
      resolved_at_ms bigint,
      fetched_at_ms bigint not null,
      primary key (asset, timeframe, window_start_ts_ms),
      constraint polymarket_resolutions_timeframe_check
        check (timeframe in ('5m', '15m')),
      constraint polymarket_resolutions_outcome_check
        check (outcome in ('up', 'down', 'void'))
    )
  `.execute(db);

  // Range scans by window across all assets at a given timeframe — the
  // dashboard aggregates ask exactly this shape.
  await sql`
    create index if not exists polymarket_resolutions_timeframe_window_idx
    on polymarket_resolutions (timeframe, window_start_ts_ms)
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`drop table if exists polymarket_resolutions`.execute(db);
}
