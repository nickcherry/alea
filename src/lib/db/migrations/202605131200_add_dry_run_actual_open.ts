import type { Database } from "@alea/lib/db/types";
import { type Kysely, sql } from "kysely";

/**
 * Retained for compatibility with databases that already received this
 * nullable dry-run audit column during earlier experiments.
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
