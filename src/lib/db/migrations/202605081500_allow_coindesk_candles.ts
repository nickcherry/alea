import type { Database } from "@alea/lib/db/types";
import { type Kysely, sql } from "kysely";

/**
 * Adds `coindesk` to the candles source check constraint. The original
 * constraint allowed `('coinbase', 'binance')`; adding the CoinDesk
 * Aggregated Liquid Index (CADLI) feed as a third source.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`alter table candles drop constraint if exists candles_source_check`.execute(
    db,
  );
  await sql`
    alter table candles
    add constraint candles_source_check
    check (source in ('coinbase', 'binance', 'coindesk'))
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`alter table candles drop constraint if exists candles_source_check`.execute(
    db,
  );
  await sql`
    alter table candles
    add constraint candles_source_check
    check (source in ('coinbase', 'binance'))
  `.execute(db);
}
