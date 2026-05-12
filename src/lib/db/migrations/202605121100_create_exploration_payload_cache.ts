import type { Database } from "@alea/lib/db/types";
import { type Kysely, sql } from "kysely";

/**
 * Persisted exploration-dashboard payload cache. The raw training
 * artifacts stay canonical; this table is a derived render cache so
 * dashboard builds do not re-aggregate tens of millions of engagement
 * rows every time.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    create table if not exists exploration_payload_cache (
      training_profile text primary key,
      schema_version integer not null,
      active_candidate_fingerprint text not null,
      filter_runs_fingerprint text not null,
      bar_regimes_fingerprint text not null,
      payload jsonb not null,
      computed_at_ms bigint not null
    )
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`drop table if exists exploration_payload_cache`.execute(db);
}
