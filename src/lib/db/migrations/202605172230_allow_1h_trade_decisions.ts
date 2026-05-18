import type { Kysely } from "kysely";
import { sql } from "kysely";

/** Ensures runtime decisions and backtest cache are hourly-only. */
export async function up(db: Kysely<unknown>): Promise<void> {
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
      add constraint candidate_backtest_timeframe_check
      check (timeframe = '1h')
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table candidate_backtest_quarter_results
      drop constraint if exists candidate_backtest_timeframe_check
  `.execute(db);
  await sql`
    alter table candidate_backtest_quarter_results
      add constraint candidate_backtest_timeframe_check
      check (timeframe = '1h')
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
