import type { Database } from "@alea/lib/db/types";
import { type Kysely, sql } from "kysely";

/**
 * Widens the candles `timeframe` check constraint to allow `15m`
 * alongside the existing `1m` and `5m`. Pyth's TradingView shim
 * supports the `15` resolution natively, and we want longer-window
 * regime / divergence research without aggregating from 5m every
 * time.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`alter table candles drop constraint if exists candles_timeframe_check`.execute(
    db,
  );
  await sql`
    alter table candles
    add constraint candles_timeframe_check
    check (timeframe in ('1m', '5m', '15m'))
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`alter table candles drop constraint if exists candles_timeframe_check`.execute(
    db,
  );
  await sql`
    alter table candles
    add constraint candles_timeframe_check
    check (timeframe in ('1m', '5m'))
  `.execute(db);
}
