import type { Database } from "@alea/lib/db/types";
import { type Kysely, sql } from "kysely";

/**
 * Adds the take-profit / stop-loss columns to each candidate-quarter
 * row. TP/SL are now part of the candidate itself (see
 * `defineCandidate`) and need to be persisted alongside the outcome
 * stats so the dashboard can render the trade profile for every row
 * without consulting the runtime registry.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table candidate_backtest_quarter_results
    add column if not exists take_profit_pct double precision not null default 0,
    add column if not exists stop_loss_pct double precision not null default 0
  `.execute(db);
  // Defaults are only there to satisfy NOT NULL on existing rows;
  // every row written from here on always supplies a real value.
  await sql`
    alter table candidate_backtest_quarter_results
    alter column take_profit_pct drop default,
    alter column stop_loss_pct drop default
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table candidate_backtest_quarter_results
    drop column if exists take_profit_pct,
    drop column if exists stop_loss_pct
  `.execute(db);
}
