import type { Database } from "@alea/lib/db/types";
import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table candidate_backtest_quarter_results
    add column if not exists cache_hash text not null default ''
  `.execute(db);

  await sql`
    create index if not exists candidate_backtest_cache_match_idx
    on candidate_backtest_quarter_results (
      candidate_id,
      asset,
      timeframe,
      quarter_start_ms,
      cache_hash
    )
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`
    drop index if exists candidate_backtest_cache_match_idx
  `.execute(db);

  await sql`
    alter table candidate_backtest_quarter_results
    drop column if exists cache_hash
  `.execute(db);
}
