import type { Database } from "@alea/lib/db/types";
import type { Kysely } from "kysely";

/**
 * Retired migration slot kept so existing Kysely migration history remains
 * valid. The current filter decision path does not add provider-specific
 * metadata columns to dry-run attempts.
 */
export async function up(_db: Kysely<Database>): Promise<void> {
  return;
}

export async function down(_db: Kysely<Database>): Promise<void> {
  return;
}
