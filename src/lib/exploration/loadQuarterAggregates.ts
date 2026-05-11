import type { DatabaseClient } from "@alea/lib/db/types";
import { sql } from "kysely";

export type QuarterAggregateRow = {
  readonly run_hash: string;
  readonly year: number;
  readonly quarter: number;
  readonly n_fires: number;
  readonly n_wins: number;
};

/**
 * Pulls all per-(run_hash, year, quarter, direction) counts out of
 * Postgres in one shot. Year/quarter are derived from `ts_ms` via
 * `to_timestamp`; Pg returns bigint as a string by default, so we cast
 * to text and parse client-side.
 */
export async function loadQuarterAggregates({
  db,
}: {
  readonly db: DatabaseClient;
}): Promise<readonly QuarterAggregateRow[]> {
  const rows = await sql<{
    run_hash: string;
    year: number;
    quarter: number;
    n_fires: string;
    n_wins: string;
  }>`
    select
      run_hash,
      extract(year from to_timestamp(ts_ms / 1000.0))::int as year,
      extract(quarter from to_timestamp(ts_ms / 1000.0))::int as quarter,
      count(*)::text as n_fires,
      coalesce(sum(won), 0)::text as n_wins
    from filter_engagements
    group by run_hash, year, quarter
  `.execute(db);

  return rows.rows.map((r) => ({
    run_hash: r.run_hash,
    year: r.year,
    quarter: r.quarter,
    n_fires: Number(r.n_fires),
    n_wins: Number(r.n_wins),
  }));
}
