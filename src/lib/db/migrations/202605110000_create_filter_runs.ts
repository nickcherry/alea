import type { Database } from "@alea/lib/db/types";
import type { Kysely } from "kysely";

/**
 * Retired migration slot. Deterministic-filter run tables were removed in
 * favor of OpenAI chart decisions; this file remains only to preserve Kysely
 * migration history for existing databases.
 */
export async function up(_db: Kysely<Database>): Promise<void> {
  return;
}

export async function down(_db: Kysely<Database>): Promise<void> {
  return;
}
