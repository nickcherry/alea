import type { Database } from "@alea/lib/db/types";
import { type Kysely, sql } from "kysely";

/**
 * Wholesale cleanup after we rip out Polymarket integration, the
 * dry-run/live-trading loops, the old training pipeline, and proxy
 * accuracy tracking. The repo no longer creates these tables, but
 * existing dev/staging DBs still hold them. All drops are
 * idempotent (`if exists`) so this is safe to re-run on a fresh DB.
 *
 * Candle tables (`candles`) are intentionally NOT touched.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  const tables = [
    "polymarket_price_samples",
    "polymarket_resolutions",
    "proxy_accuracy_payload_cache",
    "exploration_payload_cache",
    "dry_run_decisions",
    "dry_run_market_regime",
    "market_events",
    "committee_selections",
    "committee_backtest_runs",
    "filter_runs",
    "filter_engagements",
    "bar_regimes",
  ];
  for (const table of tables) {
    await sql`drop table if exists ${sql.id(table)} cascade`.execute(db);
  }
}

export async function down(_db: Kysely<Database>): Promise<void> {
  // No-op. We intentionally do not recreate the dropped tables — the
  // pivot away from Polymarket/dry-run/training is one-way.
}
