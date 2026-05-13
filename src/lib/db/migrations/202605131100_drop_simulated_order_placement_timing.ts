import type { Database } from "@alea/lib/db/types";
import { type Kysely, sql } from "kysely";

/**
 * Removes simulated order-placement timing. Dry-run does not call the
 * order API, so placement API ack latency should only be recorded by
 * the future live-order path.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table dry_run_decisions
      drop column if exists order_placement_started_at_ms,
      drop column if exists order_placement_completed_at_ms,
      drop column if exists order_placement_duration_ms
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table dry_run_decisions
      add column if not exists order_placement_started_at_ms bigint,
      add column if not exists order_placement_completed_at_ms bigint,
      add column if not exists order_placement_duration_ms integer
  `.execute(db);
}
