import type { Database } from "@alea/lib/db/types";
import { type Kysely, sql } from "kysely";

/**
 * Removes the retired research schema and normalizes the remaining dry-run
 * audit columns around filter decisions.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    do $$
    begin
      if exists (
        select 1 from information_schema.columns
        where table_name = 'dry_run_decisions'
          and column_name = 'regime_votes'
      ) and not exists (
        select 1 from information_schema.columns
        where table_name = 'dry_run_decisions'
          and column_name = 'decision_audit'
      ) then
        alter table dry_run_decisions
          rename column regime_votes to decision_audit;
      end if;
    end $$;
  `.execute(db);

  await sql`
    alter table dry_run_decisions
      add column if not exists decision_audit jsonb not null default '{}'::jsonb,
      drop constraint if exists dry_run_market_regime,
      drop column if exists market_regime
  `.execute(db);
  await sql`
    alter table dry_run_decisions
      alter column decision_audit drop default
  `.execute(db);

  await sql`
    do $$
    begin
      if exists (
        select 1 from information_schema.columns
        where table_name = 'dry_run_decision_attempts'
          and column_name = 'roster_size'
      ) and not exists (
        select 1 from information_schema.columns
        where table_name = 'dry_run_decision_attempts'
          and column_name = 'source_count'
      ) then
        alter table dry_run_decision_attempts
          rename column roster_size to source_count;
      end if;
    end $$;
  `.execute(db);

  await sql`
    alter table dry_run_decision_attempts
      add column if not exists source_count integer not null default 1,
      drop column if exists roster_size,
      drop column if exists market_regime
  `.execute(db);
  await sql`
    alter table dry_run_decision_attempts
      alter column source_count drop default
  `.execute(db);

  await sql`
    do $$
    begin
      if exists (
        select 1 from information_schema.columns
        where table_name = 'proxy_accuracy_payload_cache'
          and column_name = 'training_threshold_pct'
      ) and not exists (
        select 1 from information_schema.columns
        where table_name = 'proxy_accuracy_payload_cache'
          and column_name = 'outcome_threshold_pct'
      ) then
        alter table proxy_accuracy_payload_cache
          rename column training_threshold_pct to outcome_threshold_pct;
      end if;
    end $$;
  `.execute(db);

  await sql`drop table if exists exploration_payload_cache`.execute(db);
  await sql`drop table if exists committee_backtest_runs`.execute(db);
  await sql`drop table if exists committee_selections`.execute(db);
  await sql`drop table if exists bar_regimes`.execute(db);
  await sql`drop table if exists filter_engagements`.execute(db);
  await sql`drop table if exists filter_runs`.execute(db);
}

export async function down(_db: Kysely<Database>): Promise<void> {
  return;
}
