import type { DatabaseClient } from "@alea/lib/db/types";
import { sql } from "kysely";

export type RegimeAggregateRow = {
  readonly run_hash: string;
  readonly market_regime: string;
  readonly direction: "u" | "d";
  readonly year: number;
  readonly quarter: number;
  readonly n_engagements: number;
  readonly n_wins: number;
};

/**
 * Per-(run_hash, market_regime, direction, year, quarter) engagement/win
 * counts. Joins `filter_engagements` with `bar_regimes` on
 * (asset, period, ts_ms); filter_engagements doesn't carry
 * asset/period directly so we go through `filter_runs`.
 */
export async function loadRegimeAggregates({
  db,
}: {
  readonly db: DatabaseClient;
}): Promise<readonly RegimeAggregateRow[]> {
  const rows = await sql<{
    run_hash: string;
    market_regime: string;
    direction: "u" | "d";
    year: number;
    quarter: number;
    n_engagements: string;
    n_wins: string;
  }>`
    select
      fe.run_hash,
      br.market_regime,
      fe.direction,
      extract(year from to_timestamp(fe.ts_ms / 1000.0))::int as year,
      extract(quarter from to_timestamp(fe.ts_ms / 1000.0))::int as quarter,
      count(*)::text as n_engagements,
      coalesce(sum(fe.won), 0)::text as n_wins
    from filter_engagements fe
    join filter_runs fr on fr.run_hash = fe.run_hash
    join bar_regimes br
      on br.asset = fr.asset
      and br.period = fr.period
      and br.ts_ms = fe.ts_ms
    where br.market_regime is not null
    group by fe.run_hash, br.market_regime, fe.direction, year, quarter
  `.execute(db);

  return rows.rows.map((r) => ({
    run_hash: r.run_hash,
    market_regime: r.market_regime,
    direction: r.direction,
    year: r.year,
    quarter: r.quarter,
    n_engagements: Number(r.n_engagements),
    n_wins: Number(r.n_wins),
  }));
}
