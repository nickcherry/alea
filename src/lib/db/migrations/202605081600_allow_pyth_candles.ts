import type { Database } from "@alea/lib/db/types";
import { type Kysely, sql } from "kysely";

/**
 * Adds `pyth` to the candles source check constraint. Pyth Network is an
 * oracle median across ~10+ first-party publishers — architecturally the
 * closest free proxy we have for the Chainlink Data Streams price
 * Polymarket settles 5-minute markets on.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`alter table candles drop constraint if exists candles_source_check`.execute(
    db,
  );
  await sql`
    alter table candles
    add constraint candles_source_check
    check (source in ('coinbase', 'binance', 'coindesk', 'pyth'))
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`alter table candles drop constraint if exists candles_source_check`.execute(
    db,
  );
  await sql`
    alter table candles
    add constraint candles_source_check
    check (source in ('coinbase', 'binance', 'coindesk'))
  `.execute(db);
}
