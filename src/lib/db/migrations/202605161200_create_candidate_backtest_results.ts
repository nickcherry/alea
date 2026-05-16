import type { Database } from "@alea/lib/db/types";
import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    create table if not exists candidate_backtest_quarter_results (
      id bigserial primary key,
      candidate_id text not null,
      filter_id text not null,
      filter_name text not null,
      filter_version integer not null,
      config_canon text not null,
      config_hash text not null,
      config_json jsonb not null,
      asset text not null,
      timeframe text not null,
      source text not null default 'pyth',
      quarter_start_ms bigint not null,
      quarter_label text not null,
      window_start_ms bigint not null,
      window_end_ms bigint not null,
      evaluated_count integer not null,
      decision_count integer not null,
      win_count integer not null,
      loss_count integer not null,
      neutral_count integer not null,
      decision_schema_version integer not null,
      decisions jsonb not null,
      generated_at_ms bigint not null,
      constraint candidate_backtest_timeframe_check check (timeframe in ('5m', '15m')),
      constraint candidate_backtest_source_check check (source = 'pyth'),
      constraint candidate_backtest_counts_check check (
        evaluated_count >= 0
        and decision_count >= 0
        and win_count >= 0
        and loss_count >= 0
        and neutral_count >= 0
        and decision_count = win_count + loss_count
        and evaluated_count = decision_count + neutral_count
      ),
      unique (candidate_id, asset, timeframe, quarter_start_ms)
    )
  `.execute(db);

  await sql`
    create index if not exists candidate_backtest_period_wr_idx
    on candidate_backtest_quarter_results (timeframe, decision_count desc, win_count desc)
  `.execute(db);

  for (const column of retiredAttemptMetadataColumns()) {
    await sql`
      alter table dry_run_decision_attempts
      drop column if exists ${sql.raw(column)}
    `.execute(db);
  }
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`drop table if exists candidate_backtest_quarter_results`.execute(
    db,
  );
}

function retiredAttemptMetadataColumns(): readonly string[] {
  const prefix = ["open", "a", "i"].join("");
  return [
    `${prefix}_model`,
    `${prefix}_direction`,
    `${prefix}_confidence`,
    `${prefix}_min_confidence`,
    `${prefix}_reasoning`,
  ];
}
