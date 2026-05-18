import type { Database } from "@alea/lib/db/types";
import { type Kysely, sql } from "kysely";

/** Ensures Polymarket market-derived tables are hourly-only. */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table polymarket_resolutions
    drop constraint if exists polymarket_resolutions_timeframe_check
  `.execute(db);
  await sql`
    alter table polymarket_resolutions
    add constraint polymarket_resolutions_timeframe_check
    check (timeframe = '1h')
  `.execute(db);

  await sql`
    alter table polymarket_price_samples
    drop constraint if exists polymarket_price_samples_timeframe_check
  `.execute(db);
  await sql`
    alter table polymarket_price_samples
    add constraint polymarket_price_samples_timeframe_check
    check (timeframe = '1h')
  `.execute(db);

  await sql`drop index if exists candles_pyth_spot_proxy_join_idx`.execute(db);
  await sql`
    create index candles_pyth_spot_proxy_join_idx
    on candles (asset, timeframe, timestamp)
    include (open, close)
    where source = 'pyth'
      and product = 'spot'
      and timeframe = '1h'
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table polymarket_resolutions
    drop constraint if exists polymarket_resolutions_timeframe_check
  `.execute(db);
  await sql`
    alter table polymarket_resolutions
    add constraint polymarket_resolutions_timeframe_check
    check (timeframe = '1h')
  `.execute(db);

  await sql`
    alter table polymarket_price_samples
    drop constraint if exists polymarket_price_samples_timeframe_check
  `.execute(db);
  await sql`
    alter table polymarket_price_samples
    add constraint polymarket_price_samples_timeframe_check
    check (timeframe = '1h')
  `.execute(db);

  await sql`drop index if exists candles_pyth_spot_proxy_join_idx`.execute(db);
  await sql`
    create index candles_pyth_spot_proxy_join_idx
    on candles (asset, timeframe, timestamp)
    include (open, close)
    where source = 'pyth'
      and product = 'spot'
      and timeframe = '1h'
  `.execute(db);
}
