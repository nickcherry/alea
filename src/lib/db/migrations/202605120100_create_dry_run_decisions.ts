import type { Database } from "@alea/lib/db/types";
import { type Kysely, sql } from "kysely";

/**
 * Append-only log of every committee decision the dry-run runner
 * makes. One row per (asset, ts_ms) where the committee chose to
 * make an actionable prediction — abstains are dropped because they have no actionable
 * downstream behaviour and would bloat the table.
 *
 * - `ts_ms`: open time of the candle the committee predicts.
 * - `decided_at_ms`: when the decision was made (slightly before
 *   `ts_ms` — the runner snapshots Pyth's price ~5 s before the
 *   5-minute boundary and treats that as the prior candle's close
 *   to drive the prediction).
 * - `prediction`: 'u' or 'd' — never null, abstains aren't written.
 * - `synth_open`: the price used as the synthetic prior-bar close
 *   (and the assumed open of the target bar). Stored so the
 *   dashboard can show "we predicted UP from $63,841.20".
 * - `regime_votes`: jsonb dump of the per-regime tally for audit.
 * - `actual_close`: filled in later (`null` until the target bar
 *   actually closes) — the canonical close from `candles` once
 *   the bar settles. Used to determine `won`.
 * - `won`: 0/1, null while the outcome is still pending.
 *
 * The runner writes the row with `actual_close = null`, then a
 * follow-up sweep updates `actual_close` and `won` once the
 * target bar's data is available.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    create table if not exists dry_run_decisions (
      id bigserial primary key,
      ts_ms bigint not null,
      decided_at_ms bigint not null,
      asset text not null,
      period text not null,
      prediction char(1) not null,
      synth_open double precision not null,
      regime_votes jsonb not null,
      actual_close double precision,
      won smallint,
      constraint dry_run_prediction check (prediction in ('u', 'd')),
      constraint dry_run_won check (won is null or won in (0, 1)),
      constraint dry_run_period check (period in ('5m', '15m'))
    )
  `.execute(db);
  await sql`
    create index if not exists dry_run_decisions_by_asset_ts
    on dry_run_decisions (asset, ts_ms)
  `.execute(db);
  await sql`
    create index if not exists dry_run_decisions_pending
    on dry_run_decisions (asset, ts_ms)
    where won is null
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`drop table if exists dry_run_decisions`.execute(db);
}
