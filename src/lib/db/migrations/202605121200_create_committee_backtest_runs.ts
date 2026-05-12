import type { Database } from "@alea/lib/db/types";
import { type Kysely, sql } from "kysely";

/**
 * Persisted holdout replays of the selected trade committee. This is
 * the canonical "backtest" table: replay selected committee decisions
 * over the configured post-training window, without order-book or fill
 * simulation, and store the summary payload the dashboard reads.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    create table if not exists committee_backtest_runs (
      id bigserial primary key,
      run_profile text not null,
      training_profile text not null,
      selected_at_ms bigint,
      window_start_ms bigint not null,
      window_end_exclusive_ms bigint not null,
      started_at_ms bigint not null,
      completed_at_ms bigint not null,
      duration_ms integer not null,
      summary_json jsonb not null
    )
  `.execute(db);

  await sql`
    create index if not exists committee_backtest_runs_completed_idx
    on committee_backtest_runs (completed_at_ms desc)
  `.execute(db);

  await sql`
    create index if not exists committee_backtest_runs_profile_idx
    on committee_backtest_runs (run_profile, completed_at_ms desc)
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`drop table if exists committee_backtest_runs`.execute(db);
}
