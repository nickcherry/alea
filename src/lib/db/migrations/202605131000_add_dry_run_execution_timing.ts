import type { Database } from "@alea/lib/db/types";
import { type Kysely, sql } from "kysely";

/**
 * Adds timing telemetry for the dry-run path. `dry_run_decision_attempts`
 * records every scheduled committee evaluation, including abstains, while
 * the extra order columns time simulated placement and first fillability.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table dry_run_decisions
      add column if not exists decision_started_at_ms bigint,
      add column if not exists decision_completed_at_ms bigint,
      add column if not exists decision_duration_ms integer,
      add column if not exists order_fill_latency_ms integer
  `.execute(db);

  await sql`
    create table if not exists dry_run_decision_attempts (
      id bigserial primary key,
      ts_ms bigint not null,
      asset text not null,
      period text not null,
      decision_started_at_ms bigint not null,
      decision_completed_at_ms bigint not null,
      decision_duration_ms integer not null,
      prediction text,
      market_regime text,
      roster_size integer not null,
      up_votes integer not null,
      down_votes integer not null,
      abstain_votes integer not null,
      dry_run_decision_id bigint references dry_run_decisions(id) on delete set null
    )
  `.execute(db);

  await sql`
    create index if not exists dry_run_decision_attempts_asset_ts
    on dry_run_decision_attempts (asset, period, ts_ms desc)
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`drop index if exists dry_run_decision_attempts_asset_ts`.execute(db);
  await sql`drop table if exists dry_run_decision_attempts`.execute(db);
  await sql`
    alter table dry_run_decisions
      drop column if exists decision_started_at_ms,
      drop column if exists decision_completed_at_ms,
      drop column if exists decision_duration_ms,
      drop column if exists order_fill_latency_ms
  `.execute(db);
}
