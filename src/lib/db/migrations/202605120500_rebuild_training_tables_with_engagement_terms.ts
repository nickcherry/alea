import type { Database } from "@alea/lib/db/types";
import type { Kysely } from "kysely";

/**
 * Retired migration slot for deterministic-filter research table rebuilds.
 * Kept so existing Kysely migration history remains valid.
 */
export async function up(_db: Kysely<Database>): Promise<void> {
  return;
}

export async function down(_db: Kysely<Database>): Promise<void> {
  return;
}
