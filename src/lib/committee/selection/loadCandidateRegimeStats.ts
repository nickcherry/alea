import type { CandidateRegimeStats } from "@alea/lib/committee/selection/types";
import type { DatabaseClient } from "@alea/lib/db/types";
import { wilsonInterval95 } from "@alea/lib/exploration/wilsonInterval";
import { sql } from "kysely";

/**
 * Pulls per-(candidate, regime) aggregates from
 * `filter_engagements ⋈ bar_regimes` and folds them down to a flat
 * list the selector consumes. One row per
 * `(filter_id, filter_version, config_canon, period, market_regime)`.
 *
 * The candidate's regime stats are summed across every asset that
 * contributed a `run_hash` — same shape as the exploration page's
 * bucket logic. We compute aggregate counts AND the worst-quarter
 * WR (with a sample-size guard) in a single CTE so the loader runs
 * in two SQL round trips: one for the (regime × quarter) grouped
 * counts, one for the run_hash → bucket index from `filter_runs`.
 */
export async function loadCandidateRegimeStats({
  db,
  worstQuarterMinEngagements,
}: {
  readonly db: DatabaseClient;
  readonly worstQuarterMinEngagements: number;
}): Promise<readonly CandidateRegimeStats[]> {
  const rows = await sql<{
    filter_id: string;
    filter_version: number;
    config_canon: string;
    period: string;
    market_regime: string;
    year: number;
    quarter: number;
    n_engagements: string;
    n_wins: string;
  }>`
    select
      fr.filter_id,
      fr.filter_version,
      fr.config_canon,
      fr.period,
      br.market_regime,
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
    group by fr.filter_id, fr.filter_version, fr.config_canon, fr.period,
             br.market_regime, year, quarter
  `.execute(db);

  type Bucket = {
    filterId: string;
    filterVersion: number;
    configCanon: string;
    period: string;
    marketRegime: string;
    aggEngagements: number;
    aggWins: number;
    /** quarter WRs that cleared the sample-size guard */
    quarterWRsKept: number[];
  };
  const byKey = new Map<string, Bucket>();
  for (const r of rows.rows) {
    const nEngagements = Number(r.n_engagements);
    const nWins = Number(r.n_wins);
    const key = `${r.filter_id}|${r.filter_version}|${r.config_canon}|${r.period}|${r.market_regime}`;
    let b = byKey.get(key);
    if (b === undefined) {
      b = {
        filterId: r.filter_id,
        filterVersion: r.filter_version,
        configCanon: r.config_canon,
        period: r.period,
        marketRegime: r.market_regime,
        aggEngagements: 0,
        aggWins: 0,
        quarterWRsKept: [],
      };
      byKey.set(key, b);
    }
    b.aggEngagements += nEngagements;
    b.aggWins += nWins;
    if (nEngagements >= worstQuarterMinEngagements) {
      b.quarterWRsKept.push(nWins / nEngagements);
    }
  }

  const out: CandidateRegimeStats[] = [];
  for (const b of byKey.values()) {
    const winRate = b.aggEngagements === 0 ? 0 : b.aggWins / b.aggEngagements;
    const wilson = wilsonInterval95({ wins: b.aggWins, n: b.aggEngagements });
    const worstQuarterWinRate =
      b.quarterWRsKept.length === 0 ? null : Math.min(...b.quarterWRsKept);
    out.push({
      filterId: b.filterId,
      filterVersion: b.filterVersion,
      configCanon: b.configCanon,
      period: b.period,
      marketRegime: b.marketRegime,
      nEngagements: b.aggEngagements,
      nWins: b.aggWins,
      winRate,
      wilsonLow: wilson.low,
      worstQuarterWinRate,
    });
  }
  return out;
}
