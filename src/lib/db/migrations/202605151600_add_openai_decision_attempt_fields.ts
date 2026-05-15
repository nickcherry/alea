import type { Database } from "@alea/lib/db/types";
import { type Kysely, sql } from "kysely";

/**
 * Stores OpenAI chart-decision details on every dry-run attempt. Confidence
 * fields are nullable because the chart-decision parser no longer emits a
 * dedicated confidence scalar.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table dry_run_decision_attempts
      add column if not exists openai_model text,
      add column if not exists openai_direction text,
      add column if not exists openai_confidence double precision,
      add column if not exists openai_min_confidence double precision,
      add column if not exists openai_reasoning text
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table dry_run_decision_attempts
      drop column if exists openai_reasoning,
      drop column if exists openai_min_confidence,
      drop column if exists openai_confidence,
      drop column if exists openai_direction,
      drop column if exists openai_model
  `.execute(db);
}
