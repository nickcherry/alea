import type { Database } from "@alea/lib/db/types";
import { type Kysely, sql } from "kysely";

/** Drops stale non-hourly market-derived rows and enforces the hourly surface. */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`delete from dry_run_decisions where period <> '1h'`.execute(db);
  await sql`
    delete from candidate_backtest_quarter_results where timeframe <> '1h'
  `.execute(db);
  await sql`delete from polymarket_resolutions where timeframe <> '1h'`.execute(
    db,
  );
  await sql`delete from polymarket_price_samples where timeframe <> '1h'`.execute(
    db,
  );
  await sql`truncate table proxy_accuracy_payload_cache`.execute(db);

  await sql`
    alter table dry_run_decisions
      drop constraint if exists dry_run_period
  `.execute(db);
  await sql`
    alter table dry_run_decisions
      add constraint dry_run_period check (period = '1h')
  `.execute(db);

  await sql`
    alter table candidate_backtest_quarter_results
      drop constraint if exists candidate_backtest_timeframe_check
  `.execute(db);
  await sql`
    alter table candidate_backtest_quarter_results
      add constraint candidate_backtest_timeframe_check check (timeframe = '1h')
  `.execute(db);

  await sql`
    alter table polymarket_resolutions
      drop constraint if exists polymarket_resolutions_timeframe_check
  `.execute(db);
  await sql`
    alter table polymarket_resolutions
      add constraint polymarket_resolutions_timeframe_check check (timeframe = '1h')
  `.execute(db);

  await sql`
    alter table polymarket_price_samples
      drop constraint if exists polymarket_price_samples_timeframe_check
  `.execute(db);
  await sql`
    alter table polymarket_price_samples
      add constraint polymarket_price_samples_timeframe_check check (timeframe = '1h')
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table polymarket_price_samples
      drop constraint if exists polymarket_price_samples_timeframe_check
  `.execute(db);
  await sql`
    alter table polymarket_price_samples
      add constraint polymarket_price_samples_timeframe_check check (timeframe = '1h')
  `.execute(db);

  await sql`
    alter table polymarket_resolutions
      drop constraint if exists polymarket_resolutions_timeframe_check
  `.execute(db);
  await sql`
    alter table polymarket_resolutions
      add constraint polymarket_resolutions_timeframe_check check (timeframe = '1h')
  `.execute(db);

  await sql`
    alter table candidate_backtest_quarter_results
      drop constraint if exists candidate_backtest_timeframe_check
  `.execute(db);
  await sql`
    alter table candidate_backtest_quarter_results
      add constraint candidate_backtest_timeframe_check check (timeframe = '1h')
  `.execute(db);

  await sql`
    alter table dry_run_decisions
      drop constraint if exists dry_run_period
  `.execute(db);
  await sql`
    alter table dry_run_decisions
      add constraint dry_run_period check (period = '1h')
  `.execute(db);
}
