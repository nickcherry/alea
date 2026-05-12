import type { Database } from "@alea/lib/db/types";
import { type Kysely, sql } from "kysely";

/**
 * One row per non-abstain prediction. Together they're the
 * append-only source of truth for training results; `filter_runs`
 * stays as a fast aggregate-cache used by the leaderboard query.
 *
 * `run_hash` joins to `filter_runs.run_hash` (no formal FK because
 * we want recomputes to be able to delete-then-reinsert without
 * fighting referential constraints during the gap). `ts_ms` is the
 * open-time of the candle being PREDICTED — i.e. the candle whose
 * direction the filter is voting on, NOT the candle the filter last
 * saw. `direction` is the filter's vote ('u' or 'd'); `won` is 1
 * iff the next bar's close was on the predicted side (with
 * close == open rounding to 'u' — see runBacktest).
 *
 * The (run_hash, ts_ms) primary key gives both uniqueness and an
 * index that covers all the queries we expect:
 *   - "give me all engagements for this candidate-asset-period"
 *     (run_hash equality, range scan)
 *   - "give me Q1 2025 for this candidate" (run_hash equality + a
 *     range over ts_ms; computed via to_timestamp in SQL)
 *
 * Storage estimate at the current scale (6 filters × ~3 configs
 * each × 5 assets × 2 timeframes ≈ 200 runs, ~30k engagements/run
 * median) is ~6M rows × ~25 bytes payload = ~150 MB plus index
 * overhead. Postgres handles that without blinking.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    create table if not exists filter_engagements (
      run_hash text not null,
      ts_ms bigint not null,
      direction char(1) not null,
      won smallint not null,
      primary key (run_hash, ts_ms),
      constraint filter_engagements_direction check (direction in ('u', 'd')),
      constraint filter_engagements_won check (won in (0, 1))
    )
  `.execute(db);

  await sql`
    alter table filter_runs
    drop column if exists engagements
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table filter_runs
    add column if not exists engagements jsonb not null default '[]'::jsonb
  `.execute(db);
  await sql`drop table if exists filter_engagements`.execute(db);
}
