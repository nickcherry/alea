import type { Database } from "@alea/lib/db/types";
import type { Kysely } from "kysely";

/**
 * Retired migration slot. Market-regime tagging belonged to the
 * deleted deterministic-filter stack; the file remains only so
 * existing Kysely migration history stays valid.
 */
export async function up(_db: Kysely<Database>): Promise<void> {
  return;
}

export async function down(_db: Kysely<Database>): Promise<void> {
  return;
}
