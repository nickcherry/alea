import type { Database } from "@alea/lib/db/types";
import { type Kysely, sql } from "kysely";

/**
 * Adds `outcome_window_bars` to each candidate-quarter row. The
 * outcome window is now per-candidate (see `defineCandidate`) and
 * needs to be persisted so the dashboard can render the trade
 * profile without consulting the runtime registry.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table candidate_backtest_quarter_results
    add column if not exists outcome_window_bars integer not null default 0
  `.execute(db);
  await sql`
    alter table candidate_backtest_quarter_results
    alter column outcome_window_bars drop default
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table candidate_backtest_quarter_results
    drop column if exists outcome_window_bars
  `.execute(db);
}
