import type { Database } from "@alea/lib/db/types";
import { type Kysely, sql } from "kysely";

/**
 * Compact per-market Polymarket price paths.
 *
 * Each row is one completed up/down market for one asset/timeframe. The
 * `samples` JSONB column is intentionally tuple-shaped rather than
 * object-shaped to keep the row small:
 *
 *   [offset_ms, up_price_bps, quality_code]
 *
 * `up_price_bps` is the normalized UP contract price on a 0..10000 scale
 * (5000 == 50c). `quality_code` is owned by the sampler implementation
 * and distinguishes direct UP BBO mids from inferred/fallback prices.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    create table if not exists polymarket_price_samples (
      asset text not null,
      timeframe text not null,
      window_start_ts_ms bigint not null,
      window_end_ts_ms bigint not null,
      condition_id text not null,
      up_token_id text not null,
      down_token_id text not null,
      schema_version smallint not null default 1,
      sample_interval_ms integer not null,
      first_sample_ts_ms bigint,
      last_sample_ts_ms bigint,
      finalized_at_ms bigint not null,
      sample_count integer not null,
      missing_sample_count integer not null,
      samples jsonb not null,
      primary key (asset, timeframe, window_start_ts_ms),
      constraint polymarket_price_samples_timeframe_check
        check (timeframe in ('5m', '15m')),
      constraint polymarket_price_samples_sample_interval_check
        check (sample_interval_ms > 0),
      constraint polymarket_price_samples_sample_count_check
        check (sample_count >= 0 and missing_sample_count >= 0)
    )
  `.execute(db);

  await sql`
    create index if not exists polymarket_price_samples_timeframe_window_idx
    on polymarket_price_samples (timeframe, window_start_ts_ms)
  `.execute(db);

  await sql`
    create index if not exists polymarket_price_samples_asset_timeframe_window_idx
    on polymarket_price_samples (asset, timeframe, window_start_ts_ms)
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`drop table if exists polymarket_price_samples`.execute(db);
}
