import type { Database } from "@alea/lib/db/types";
import { type Kysely, sql } from "kysely";

/**
 * Adds the market-regime tag to dry-run decisions. The regime is
 * classified at decision time from the bar window the committee
 * sees (see `lib/regime/classify.ts`) and lets the dashboard slice
 * win rate by market state — e.g. "we hit 58 % in low-vol-ranging
 * but only 49 % in high-vol-trending".
 *
 * Nullable because earlier rows pre-date the column and the
 * classifier sometimes can't decide on very short bar buffers; both
 * cases render as "—" on the dashboard.
 *
 * Allowed values match `MarketRegime` in `lib/regime/types.ts`.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table dry_run_decisions
    add column if not exists market_regime text
  `.execute(db);
  await sql`
    alter table dry_run_decisions
    drop constraint if exists dry_run_market_regime
  `.execute(db);
  await sql`
    alter table dry_run_decisions
    add constraint dry_run_market_regime
    check (
      market_regime is null
      or market_regime in (
        'low_vol_trending',
        'low_vol_ranging',
        'high_vol_trending',
        'high_vol_ranging'
      )
    )
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table dry_run_decisions
    drop constraint if exists dry_run_market_regime
  `.execute(db);
  await sql`
    alter table dry_run_decisions
    drop column if exists market_regime
  `.execute(db);
}
