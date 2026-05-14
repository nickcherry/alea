import type { Database } from "@alea/lib/db/types";
import { type Kysely, sql } from "kysely";

/**
 * Persist the exact Polymarket market ids used by dry-run order
 * simulation so a decision row can be audited back to the venue window
 * it subscribed to.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table dry_run_decisions
      add column if not exists order_market_ref text,
      add column if not exists order_up_token_ref text,
      add column if not exists order_down_token_ref text
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table dry_run_decisions
      drop column if exists order_market_ref,
      drop column if exists order_up_token_ref,
      drop column if exists order_down_token_ref
  `.execute(db);
}
