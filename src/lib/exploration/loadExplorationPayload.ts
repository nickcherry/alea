import type { DatabaseClient } from "@alea/lib/db/types";
import type {
  ExplorationCandidateRow,
  ExplorationPayload,
  ExplorationQuarter,
  ExplorationRegimeStats,
  FilterPeerOverlap,
} from "@alea/lib/exploration/types";
import { wilsonInterval95 } from "@alea/lib/exploration/wilsonInterval";
import "@alea/lib/filters/all";
import { getFilter } from "@alea/lib/filters/registry";
import type { Regime } from "@alea/lib/filters/types";
import { sql } from "kysely";

const TOP_PEERS_PER_FILTER = 5;

/**
 * Loads every row in `filter_runs`, then collapses across `asset` so
 * the dashboard shows one row per (filter, version, config, period).
 * A filter that crushes one asset but tanks the rest doesn't get to
 * cherry-pick — its aggregate WR reflects every asset it ran on.
 *
 * Quarterly buckets are derived from `filter_engagements` and merged
 * the same way (a quarter's WR is summed across every asset that
 * contributed to that quarter).
 *
 * Rows are sorted by total win rate descending, with ties broken by
 * total fires descending.
 */
export async function loadExplorationPayload({
  db,
  now = () => Date.now(),
}: {
  readonly db: DatabaseClient;
  readonly now?: () => number;
}): Promise<ExplorationPayload> {
  const [perAssetRows, quarterRows, peerOverlapRows, regimeRows] =
    await Promise.all([
    db
      .selectFrom("filter_runs")
      .select([
        "run_hash",
        "filter_id",
        "filter_version",
        "config",
        "config_canon",
        "period",
        "asset",
        "n_bars",
        "n_fires_up",
        "n_wins_up",
        "n_fires_down",
        "n_wins_down",
      ])
      .execute(),
    loadQuarterAggregates({ db }),
    loadFilterPeerOverlaps({ db }),
    loadRegimeAggregates({ db }),
  ]);

  // Index the peer-overlap table by (period, filterId) so we can
  // tack the top-K peers onto each row's payload below.
  const peersByPeriodFilter = new Map<string, FilterPeerOverlap[]>();
  for (const row of peerOverlapRows) {
    const aReg = regimeOf(row.filterA);
    const bReg = regimeOf(row.filterB);
    if (aReg === null || bReg === null) continue;
    pushPeer(peersByPeriodFilter, row.period, row.filterA, {
      otherFilterId: row.filterB,
      otherRegime: bReg,
      jaccard: row.jaccard,
    });
    pushPeer(peersByPeriodFilter, row.period, row.filterB, {
      otherFilterId: row.filterA,
      otherRegime: aReg,
      jaccard: row.jaccard,
    });
  }
  for (const list of peersByPeriodFilter.values()) {
    list.sort((a, b) => b.jaccard - a.jaccard);
    list.splice(TOP_PEERS_PER_FILTER);
  }

  // First, map run_hash -> the (filter, version, config_canon, period)
  // bucket it contributes to, so we can join quarter rows back.
  const runHashToBucketKey = new Map<string, string>();
  for (const r of perAssetRows) {
    runHashToBucketKey.set(r.run_hash, bucketKey(r));
  }

  // Aggregate per-asset rows into per-bucket totals.
  type Bucket = {
    filterId: string;
    filterVersion: number;
    config: unknown;
    configCanon: string;
    period: string;
    nBars: number; // max across assets — informational, not summed
    nFires: number;
    nWins: number;
    nFiresUp: number;
    nWinsUp: number;
    nFiresDown: number;
    nWinsDown: number;
    quartersByLabel: Map<
      string,
      {
        year: number;
        quarter: number;
        nFires: number;
        nWins: number;
      }
    >;
    regimes: Map<
      string,
      {
        nFiresUp: number;
        nWinsUp: number;
        nFiresDown: number;
        nWinsDown: number;
        quartersByLabel: Map<
          string,
          {
            year: number;
            quarter: number;
            nFires: number;
            nWins: number;
          }
        >;
      }
    >;
  };
  const buckets = new Map<string, Bucket>();
  for (const r of perAssetRows) {
    const key = bucketKey(r);
    let b = buckets.get(key);
    if (b === undefined) {
      b = {
        filterId: r.filter_id,
        filterVersion: r.filter_version,
        config: r.config,
        configCanon: r.config_canon,
        period: r.period,
        nBars: 0,
        nFires: 0,
        nWins: 0,
        nFiresUp: 0,
        nWinsUp: 0,
        nFiresDown: 0,
        nWinsDown: 0,
        quartersByLabel: new Map(),
        regimes: new Map(),
      };
      buckets.set(key, b);
    }
    b.nBars = Math.max(b.nBars, r.n_bars);
    b.nFires += r.n_fires_up + r.n_fires_down;
    b.nWins += r.n_wins_up + r.n_wins_down;
    b.nFiresUp += r.n_fires_up;
    b.nWinsUp += r.n_wins_up;
    b.nFiresDown += r.n_fires_down;
    b.nWinsDown += r.n_wins_down;
  }

  // Fold quarter aggregates into their buckets. Each (run_hash,
  // year, quarter, direction) row contributes to one bucket's quarter
  // total.
  for (const q of quarterRows) {
    const key = runHashToBucketKey.get(q.run_hash);
    if (key === undefined) continue;
    const b = buckets.get(key);
    if (b === undefined) continue;
    const label = `${q.year}-Q${q.quarter}`;
    let qb = b.quartersByLabel.get(label);
    if (qb === undefined) {
      qb = {
        year: q.year,
        quarter: q.quarter,
        nFires: 0,
        nWins: 0,
      };
      b.quartersByLabel.set(label, qb);
    }
    qb.nFires += q.n_fires;
    qb.nWins += q.n_wins;
  }

  // Fold per-(run_hash, market_regime, direction, year, quarter)
  // rows into buckets. Each row contributes to one bucket → one
  // regime → one direction bucket AND one quarter cell. The TS
  // here is the same shape as the SQL grouping, summed along the
  // axes the dashboard slices: direction for up/down splits,
  // quarter for the strip chart, both axes summed together for the
  // headline regime total.
  for (const rr of regimeRows) {
    const key = runHashToBucketKey.get(rr.run_hash);
    if (key === undefined) continue;
    const b = buckets.get(key);
    if (b === undefined) continue;
    let rb = b.regimes.get(rr.market_regime);
    if (rb === undefined) {
      rb = {
        nFiresUp: 0,
        nWinsUp: 0,
        nFiresDown: 0,
        nWinsDown: 0,
        quartersByLabel: new Map(),
      };
      b.regimes.set(rr.market_regime, rb);
    }
    if (rr.direction === "u") {
      rb.nFiresUp += rr.n_fires;
      rb.nWinsUp += rr.n_wins;
    } else {
      rb.nFiresDown += rr.n_fires;
      rb.nWinsDown += rr.n_wins;
    }
    const label = `${rr.year}-Q${rr.quarter}`;
    let qb = rb.quartersByLabel.get(label);
    if (qb === undefined) {
      qb = {
        year: rr.year,
        quarter: rr.quarter,
        nFires: 0,
        nWins: 0,
      };
      rb.quartersByLabel.set(label, qb);
    }
    qb.nFires += rr.n_fires;
    qb.nWins += rr.n_wins;
  }

  const enriched: ExplorationCandidateRow[] = [];
  for (const [id, b] of buckets.entries()) {
    const ci = wilsonInterval95({ wins: b.nWins, n: b.nFires });
    const quarters: ExplorationQuarter[] = Array.from(
      b.quartersByLabel.entries(),
    )
      .map(([label, qb]) => ({
        label,
        year: qb.year,
        quarter: qb.quarter,
        nFires: qb.nFires,
        nWins: qb.nWins,
        winRate: qb.nFires === 0 ? null : qb.nWins / qb.nFires,
      }))
      .sort((a, c) => {
        if (a.year !== c.year) return a.year - c.year;
        return a.quarter - c.quarter;
      });
    const quarterRates = quarters
      .map((q) => q.winRate)
      .filter((v): v is number => v !== null);
    const regime = regimeOf(b.filterId);
    if (regime === null) {
      // Filter row exists in `filter_runs` but the file isn't
      // registered (deleted but rows not yet purged). Skip — it
      // shouldn't appear on the dashboard.
      continue;
    }
    const topPeers =
      peersByPeriodFilter.get(`${b.period}|${b.filterId}`) ?? [];
    const byRegime: Record<string, ExplorationRegimeStats> = {};
    for (const [regime, stats] of b.regimes.entries()) {
      const rFires = stats.nFiresUp + stats.nFiresDown;
      const rWins = stats.nWinsUp + stats.nWinsDown;
      const rci = wilsonInterval95({ wins: rWins, n: rFires });
      const rQuarters: ExplorationQuarter[] = Array.from(
        stats.quartersByLabel.entries(),
      )
        .map(([label, qb]) => ({
          label,
          year: qb.year,
          quarter: qb.quarter,
          nFires: qb.nFires,
          nWins: qb.nWins,
          winRate: qb.nFires === 0 ? null : qb.nWins / qb.nFires,
        }))
        .sort((a, c) => {
          if (a.year !== c.year) return a.year - c.year;
          return a.quarter - c.quarter;
        });
      const rQuarterRates = rQuarters
        .map((q) => q.winRate)
        .filter((v): v is number => v !== null);
      byRegime[regime] = {
        nFires: rFires,
        nWins: rWins,
        winRate: rFires === 0 ? null : rWins / rFires,
        ciLow: rFires === 0 ? 0 : rci.low,
        ciHigh: rFires === 0 ? 0 : rci.high,
        nFiresUp: stats.nFiresUp,
        nWinsUp: stats.nWinsUp,
        winRateUp:
          stats.nFiresUp === 0 ? null : stats.nWinsUp / stats.nFiresUp,
        nFiresDown: stats.nFiresDown,
        nWinsDown: stats.nWinsDown,
        winRateDown:
          stats.nFiresDown === 0
            ? null
            : stats.nWinsDown / stats.nFiresDown,
        quarters: rQuarters,
        quarterWinRateMin:
          rQuarterRates.length === 0 ? null : Math.min(...rQuarterRates),
        quarterWinRateMax:
          rQuarterRates.length === 0 ? null : Math.max(...rQuarterRates),
      };
    }
    enriched.push({
      id,
      filterId: b.filterId,
      filterVersion: b.filterVersion,
      config: b.config,
      configCanon: b.configCanon,
      period: b.period as ExplorationCandidateRow["period"],
      nBars: b.nBars,
      nFires: b.nFires,
      nWins: b.nWins,
      winRate: b.nFires === 0 ? null : b.nWins / b.nFires,
      ciLow: b.nFires === 0 ? 0 : ci.low,
      ciHigh: b.nFires === 0 ? 0 : ci.high,
      nFiresUp: b.nFiresUp,
      nWinsUp: b.nWinsUp,
      winRateUp: b.nFiresUp === 0 ? null : b.nWinsUp / b.nFiresUp,
      nFiresDown: b.nFiresDown,
      nWinsDown: b.nWinsDown,
      winRateDown: b.nFiresDown === 0 ? null : b.nWinsDown / b.nFiresDown,
      quarters,
      quarterWinRateMin:
        quarterRates.length === 0 ? null : Math.min(...quarterRates),
      quarterWinRateMax:
        quarterRates.length === 0 ? null : Math.max(...quarterRates),
      regime,
      topPeers,
      byRegime,
    });
  }

  enriched.sort((a, b) => {
    const aRate = a.winRate ?? -1;
    const bRate = b.winRate ?? -1;
    if (bRate !== aRate) {
      return bRate - aRate;
    }
    return b.nFires - a.nFires;
  });

  return {
    generatedAtMs: now(),
    rowCount: enriched.length,
    rows: enriched,
  };
}

function bucketKey(row: {
  readonly filter_id: string;
  readonly filter_version: number;
  readonly config_canon: string;
  readonly period: string;
}): string {
  return `${row.filter_id}|${row.filter_version}|${row.config_canon}|${row.period}`;
}

/**
 * Internal: pulls all per-(run_hash, year, quarter, direction)
 * counts out of Postgres in one shot. Year/quarter are derived from
 * `ts_ms` via `to_timestamp` — there's no stored quarter column.
 * Pg returns bigint as a string by default; we cast to text and
 * parse client-side since the values fit comfortably in a JS number.
 */
async function loadQuarterAggregates({
  db,
}: {
  readonly db: DatabaseClient;
}): Promise<
  ReadonlyArray<{
    readonly run_hash: string;
    readonly year: number;
    readonly quarter: number;
    readonly n_fires: number;
    readonly n_wins: number;
  }>
> {
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

/**
 * Computes the Jaccard similarity of co-firing for every pair of
 * (filter family, filter family) per period:
 *
 *   J(A, B) = |bars where A fired ∩ bars where B fired|
 *             ───────────────────────────────────────────
 *             |bars where A fired ∪ bars where B fired|
 *
 * Filter-family level (not per-config) — the union of all of that
 * filter's configs' fires defines its "fire-bar set". Two
 * configurations of the same filter shouldn't count as separate
 * peers; that's why we union them.
 *
 * Implementation: SQL self-join through a deduplicated
 * `(filter_id, period, asset, ts_ms)` view. Postgres handles the
 * 21² × 2 periods table; the inner self-join is bounded by the
 * average number of filters firing per bar.
 */
async function loadFilterPeerOverlaps({
  db,
}: {
  readonly db: DatabaseClient;
}): Promise<
  ReadonlyArray<{
    readonly period: string;
    readonly filterA: string;
    readonly filterB: string;
    readonly jaccard: number;
  }>
> {
  const rows = await sql<{
    period: string;
    filter_a: string;
    filter_b: string;
    shared: string;
    total_a: string;
    total_b: string;
  }>`
    with filter_fire_bars as (
      select distinct
        fr.filter_id,
        fr.period,
        fr.asset,
        fe.ts_ms
      from filter_runs fr
      join filter_engagements fe on fe.run_hash = fr.run_hash
    ),
    filter_totals as (
      select filter_id, period, count(*) as total
      from filter_fire_bars
      group by filter_id, period
    ),
    pair_shared as (
      select
        a.filter_id as filter_a,
        b.filter_id as filter_b,
        a.period as period,
        count(*) as shared
      from filter_fire_bars a
      join filter_fire_bars b
        on a.period = b.period
        and a.asset = b.asset
        and a.ts_ms = b.ts_ms
       and a.filter_id < b.filter_id
      group by a.filter_id, b.filter_id, a.period
    )
    select
      p.period,
      p.filter_a,
      p.filter_b,
      p.shared::text as shared,
      ta.total::text as total_a,
      tb.total::text as total_b
    from pair_shared p
    join filter_totals ta on ta.filter_id = p.filter_a and ta.period = p.period
    join filter_totals tb on tb.filter_id = p.filter_b and tb.period = p.period
  `.execute(db);

  return rows.rows.map((r) => {
    const shared = Number(r.shared);
    const totalA = Number(r.total_a);
    const totalB = Number(r.total_b);
    const union = totalA + totalB - shared;
    const jaccard = union === 0 ? 0 : shared / union;
    return {
      period: r.period,
      filterA: r.filter_a,
      filterB: r.filter_b,
      jaccard,
    };
  });
}

/**
 * Per-(run_hash, market_regime, direction, year, quarter) fire/win
 * counts. Joins `filter_engagements` with `bar_regimes` on
 * (asset, period, ts_ms); filter_engagements doesn't carry
 * asset/period directly so we go through `filter_runs`. Rows with a
 * null market_regime (early-history bars where the classifier had
 * < 100 priors) are dropped — they account for ~0.07 % of bars.
 *
 * One query feeds three views: total per-regime, up/down split per
 * regime, and per-(regime, quarter) strip. The TS-side enrichment
 * sums along the appropriate axes.
 */
async function loadRegimeAggregates({
  db,
}: {
  readonly db: DatabaseClient;
}): Promise<
  ReadonlyArray<{
    readonly run_hash: string;
    readonly market_regime: string;
    readonly direction: "u" | "d";
    readonly year: number;
    readonly quarter: number;
    readonly n_fires: number;
    readonly n_wins: number;
  }>
> {
  const rows = await sql<{
    run_hash: string;
    market_regime: string;
    direction: "u" | "d";
    year: number;
    quarter: number;
    n_fires: string;
    n_wins: string;
  }>`
    select
      fe.run_hash,
      br.market_regime,
      fe.direction,
      extract(year from to_timestamp(fe.ts_ms / 1000.0))::int as year,
      extract(quarter from to_timestamp(fe.ts_ms / 1000.0))::int as quarter,
      count(*)::text as n_fires,
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
    n_fires: Number(r.n_fires),
    n_wins: Number(r.n_wins),
  }));
}

function regimeOf(filterId: string): Regime | null {
  const entry = getFilter(filterId);
  return entry === undefined ? null : entry.filter.regime;
}

function pushPeer(
  map: Map<string, FilterPeerOverlap[]>,
  period: string,
  filterId: string,
  peer: FilterPeerOverlap,
): void {
  const key = `${period}|${filterId}`;
  let list = map.get(key);
  if (list === undefined) {
    list = [];
    map.set(key, list);
  }
  list.push(peer);
}
