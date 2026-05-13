import type { Database } from "@alea/lib/db/types";
import { type Kysely, sql } from "kysely";

/**
 * A one-candle-earlier decision no longer has a reliable approximation
 * of the target candle's open at decision time. Persist the real target
 * open when scoring so dashboards can distinguish decision reference
 * price from outcome open.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table dry_run_decisions
    add column if not exists actual_open double precision
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table dry_run_decisions
    drop column if exists actual_open
  `.execute(db);
}
