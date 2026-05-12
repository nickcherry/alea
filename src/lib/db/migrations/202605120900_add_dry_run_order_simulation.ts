import type { Database } from "@alea/lib/db/types";
import { type Kysely, sql } from "kysely";

/**
 * Adds dry-run execution simulation columns. `won` remains the signal
 * correctness field; these columns describe whether the post-open
 * pretend order was eligible, placed, filled, or left unfilled.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table dry_run_decisions
      add column if not exists order_status text not null default 'untracked',
      add column if not exists order_placed_at_ms bigint,
      add column if not exists order_observed_price double precision,
      add column if not exists order_limit_price double precision,
      add column if not exists order_confidence double precision,
      add column if not exists order_filled_at_ms bigint,
      add column if not exists order_fill_price double precision,
      add column if not exists order_expires_at_ms bigint
  `.execute(db);

  await sql`
    alter table dry_run_decisions
      drop constraint if exists dry_run_order_status
  `.execute(db);
  await sql`
    alter table dry_run_decisions
      add constraint dry_run_order_status check (
        order_status in (
          'untracked',
          'pending_placement',
          'skipped_no_market',
          'skipped_no_price',
          'skipped_price_window',
          'skipped_confidence',
          'placed',
          'filled',
          'unfilled'
        )
      )
  `.execute(db);
  await sql`
    create index if not exists dry_run_decisions_pending_orders
    on dry_run_decisions (asset, ts_ms)
    where order_status in ('pending_placement', 'placed')
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`drop index if exists dry_run_decisions_pending_orders`.execute(db);
  await sql`
    alter table dry_run_decisions
      drop constraint if exists dry_run_order_status,
      drop column if exists order_status,
      drop column if exists order_placed_at_ms,
      drop column if exists order_observed_price,
      drop column if exists order_limit_price,
      drop column if exists order_confidence,
      drop column if exists order_filled_at_ms,
      drop column if exists order_fill_price,
      drop column if exists order_expires_at_ms
  `.execute(db);
}
