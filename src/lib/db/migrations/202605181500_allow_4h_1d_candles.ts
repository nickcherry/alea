import type { Database } from "@alea/lib/db/types";
import { type Kysely, sql } from "kysely";

/**
 * Widens the canonical candle store to accept 4h and 1d bars. These rows
 * are ingestion/research data only; trade-decision and Polymarket
 * settlement period constraints remain limited to the explicit trading
 * period lists.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`alter table candles drop constraint if exists candles_timeframe_check`.execute(
    db,
  );
  await sql`
    alter table candles
    add constraint candles_timeframe_check
    check (timeframe in ('1m', '5m', '15m', '1h', '4h', '1d'))
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`alter table candles drop constraint if exists candles_timeframe_check`.execute(
    db,
  );
  await sql`
    alter table candles
    add constraint candles_timeframe_check
    check (timeframe in ('1m', '5m', '15m', '1h'))
  `.execute(db);
}
