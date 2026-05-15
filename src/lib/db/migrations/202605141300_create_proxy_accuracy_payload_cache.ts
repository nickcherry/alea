import type { Database } from "@alea/lib/db/types";
import { type Kysely, sql } from "kysely";

/**
 * Persisted proxy-accuracy dashboard payload cache. The underlying
 * `polymarket_resolutions` and Pyth candles remain canonical; this cache
 * avoids rejoining the full historical proxy dataset on every dashboard
 * rebuild.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    create table if not exists proxy_accuracy_payload_cache (
      cache_key text primary key,
      schema_version integer not null,
      resolutions_fingerprint text not null,
      pyth_candle_fingerprint text not null,
      outcome_threshold_pct double precision not null,
      payload jsonb not null,
      computed_at_ms bigint not null
    )
  `.execute(db);

  await sql`
    create index if not exists candles_pyth_spot_proxy_join_idx
    on candles (asset, timeframe, timestamp)
    include (open, close)
    where source = 'pyth'
      and product = 'spot'
      and timeframe in ('5m', '15m')
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`drop table if exists proxy_accuracy_payload_cache`.execute(db);
  await sql`drop index if exists candles_pyth_spot_proxy_join_idx`.execute(db);
}
