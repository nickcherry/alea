import type { Database } from "@alea/lib/db/types";
import { type Kysely, sql } from "kysely";

/**
 * Proxy accuracy now follows the 1h Polymarket surface. Recreate the helper
 * index so dashboard rebuilds can join 1h Pyth candles efficiently.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`drop index if exists candles_pyth_spot_proxy_join_idx`.execute(db);
  await sql`
    create index if not exists candles_pyth_spot_proxy_join_idx
    on candles (asset, timeframe, timestamp)
    include (open, close)
    where source = 'pyth'
      and product = 'spot'
      and timeframe = '1h'
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`drop index if exists candles_pyth_spot_proxy_join_idx`.execute(db);
  await sql`
    create index if not exists candles_pyth_spot_proxy_join_idx
    on candles (asset, timeframe, timestamp)
    include (open, close)
    where source = 'pyth'
      and product = 'spot'
      and timeframe = '1h'
  `.execute(db);
}
