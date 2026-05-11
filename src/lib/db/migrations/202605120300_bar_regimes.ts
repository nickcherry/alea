import type { Database } from "@alea/lib/db/types";
import { type Kysely, sql } from "kysely";

/**
 * Per-bar market regime tags. One row per (asset, period, ts_ms).
 *
 * Populated by the `regimes:backfill` CLI command, which loads the
 * candle history and runs the same classifier the dry-run loop uses
 * (`lib/regime/classify.ts`). The exploration aggregator joins this
 * table with `filter_engagements` to stratify a filter's fires by
 * the market regime they happened in — so the dashboard can answer
 * "how does zscore_reversion behave when the market is high-vol
 * ranging" without re-running the backtest.
 *
 * Regimes can be null at the very start of an asset's history where
 * the classifier hasn't seen enough bars (it needs ~100 of priors
 * for a stable read). Those bars still appear in `candles` and
 * `filter_engagements`; we just exclude them from per-regime
 * aggregates.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    create table if not exists bar_regimes (
      asset text not null,
      period text not null,
      ts_ms bigint not null,
      market_regime text,
      primary key (asset, period, ts_ms),
      constraint bar_regimes_valid_regime check (
        market_regime is null
        or market_regime in (
          'low_vol_trending',
          'low_vol_ranging',
          'high_vol_trending',
          'high_vol_ranging'
        )
      )
    )
  `.execute(db);
  await sql`
    create index if not exists bar_regimes_by_regime
    on bar_regimes (period, market_regime)
    where market_regime is not null
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`drop table if exists bar_regimes`.execute(db);
}
