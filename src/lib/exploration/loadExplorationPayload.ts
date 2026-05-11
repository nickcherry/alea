import "@alea/lib/filters/all";

import type { DatabaseClient } from "@alea/lib/db/types";
import { loadFilterPeerOverlaps } from "@alea/lib/exploration/loadFilterPeerOverlaps";
import { loadQuarterAggregates } from "@alea/lib/exploration/loadQuarterAggregates";
import { loadRegimeAggregates } from "@alea/lib/exploration/loadRegimeAggregates";
import type {
  ExplorationCandidateRow,
  ExplorationPayload,
  ExplorationQuarter,
  ExplorationRegimeStats,
  FilterPeerOverlap,
} from "@alea/lib/exploration/types";
import { wilsonInterval95 } from "@alea/lib/exploration/wilsonInterval";
import { getFilter } from "@alea/lib/filters/registry";
import type { FilterFamily } from "@alea/lib/filters/types";

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
 * total engagements descending.
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
          "n_engagements_up",
          "n_wins_up",
          "n_engagements_down",
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
    const aFamily = familyOf(row.filterA);
    const bFamily = familyOf(row.filterB);
    if (aFamily === null || bFamily === null) {
      continue;
    }
    pushPeer(peersByPeriodFilter, row.period, row.filterA, {
      otherFilterId: row.filterB,
      otherFamily: bFamily,
      jaccard: row.jaccard,
    });
    pushPeer(peersByPeriodFilter, row.period, row.filterB, {
      otherFilterId: row.filterA,
      otherFamily: aFamily,
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
    nEngagements: number;
    nWins: number;
    nEngagementsUp: number;
    nWinsUp: number;
    nEngagementsDown: number;
    nWinsDown: number;
    quartersByLabel: Map<
      string,
      {
        year: number;
        quarter: number;
        nEngagements: number;
        nWins: number;
      }
    >;
    regimes: Map<
      string,
      {
        nEngagementsUp: number;
        nWinsUp: number;
        nEngagementsDown: number;
        nWinsDown: number;
        quartersByLabel: Map<
          string,
          {
            year: number;
            quarter: number;
            nEngagements: number;
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
        nEngagements: 0,
        nWins: 0,
        nEngagementsUp: 0,
        nWinsUp: 0,
        nEngagementsDown: 0,
        nWinsDown: 0,
        quartersByLabel: new Map(),
        regimes: new Map(),
      };
      buckets.set(key, b);
    }
    b.nBars = Math.max(b.nBars, r.n_bars);
    b.nEngagements += r.n_engagements_up + r.n_engagements_down;
    b.nWins += r.n_wins_up + r.n_wins_down;
    b.nEngagementsUp += r.n_engagements_up;
    b.nWinsUp += r.n_wins_up;
    b.nEngagementsDown += r.n_engagements_down;
    b.nWinsDown += r.n_wins_down;
  }

  // Fold quarter aggregates into their buckets. Each (run_hash,
  // year, quarter, direction) row contributes to one bucket's quarter
  // total.
  for (const q of quarterRows) {
    const key = runHashToBucketKey.get(q.run_hash);
    if (key === undefined) {
      continue;
    }
    const b = buckets.get(key);
    if (b === undefined) {
      continue;
    }
    const label = `${q.year}-Q${q.quarter}`;
    let qb = b.quartersByLabel.get(label);
    if (qb === undefined) {
      qb = {
        year: q.year,
        quarter: q.quarter,
        nEngagements: 0,
        nWins: 0,
      };
      b.quartersByLabel.set(label, qb);
    }
    qb.nEngagements += q.n_engagements;
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
    if (key === undefined) {
      continue;
    }
    const b = buckets.get(key);
    if (b === undefined) {
      continue;
    }
    let rb = b.regimes.get(rr.market_regime);
    if (rb === undefined) {
      rb = {
        nEngagementsUp: 0,
        nWinsUp: 0,
        nEngagementsDown: 0,
        nWinsDown: 0,
        quartersByLabel: new Map(),
      };
      b.regimes.set(rr.market_regime, rb);
    }
    if (rr.direction === "u") {
      rb.nEngagementsUp += rr.n_engagements;
      rb.nWinsUp += rr.n_wins;
    } else {
      rb.nEngagementsDown += rr.n_engagements;
      rb.nWinsDown += rr.n_wins;
    }
    const label = `${rr.year}-Q${rr.quarter}`;
    let qb = rb.quartersByLabel.get(label);
    if (qb === undefined) {
      qb = {
        year: rr.year,
        quarter: rr.quarter,
        nEngagements: 0,
        nWins: 0,
      };
      rb.quartersByLabel.set(label, qb);
    }
    qb.nEngagements += rr.n_engagements;
    qb.nWins += rr.n_wins;
  }

  const enriched: ExplorationCandidateRow[] = [];
  for (const [id, b] of buckets.entries()) {
    const ci = wilsonInterval95({ wins: b.nWins, n: b.nEngagements });
    const quarters: ExplorationQuarter[] = Array.from(
      b.quartersByLabel.entries(),
    )
      .map(([label, qb]) => ({
        label,
        year: qb.year,
        quarter: qb.quarter,
        nEngagements: qb.nEngagements,
        nWins: qb.nWins,
        winRate: qb.nEngagements === 0 ? null : qb.nWins / qb.nEngagements,
      }))
      .sort((a, c) => {
        if (a.year !== c.year) {
          return a.year - c.year;
        }
        return a.quarter - c.quarter;
      });
    const quarterRates = quarters
      .map((q) => q.winRate)
      .filter((v): v is number => v !== null);
    const family = familyOf(b.filterId);
    if (family === null) {
      // Filter row exists in `filter_runs` but the file isn't
      // registered (deleted but rows not yet purged). Skip — it
      // shouldn't appear on the dashboard.
      continue;
    }
    const topPeers = peersByPeriodFilter.get(`${b.period}|${b.filterId}`) ?? [];
    const byRegime: Record<string, ExplorationRegimeStats> = {};
    for (const [regime, stats] of b.regimes.entries()) {
      const rEngagements = stats.nEngagementsUp + stats.nEngagementsDown;
      const rWins = stats.nWinsUp + stats.nWinsDown;
      const rci = wilsonInterval95({ wins: rWins, n: rEngagements });
      const rQuarters: ExplorationQuarter[] = Array.from(
        stats.quartersByLabel.entries(),
      )
        .map(([label, qb]) => ({
          label,
          year: qb.year,
          quarter: qb.quarter,
          nEngagements: qb.nEngagements,
          nWins: qb.nWins,
          winRate: qb.nEngagements === 0 ? null : qb.nWins / qb.nEngagements,
        }))
        .sort((a, c) => {
          if (a.year !== c.year) {
            return a.year - c.year;
          }
          return a.quarter - c.quarter;
        });
      const rQuarterRates = rQuarters
        .map((q) => q.winRate)
        .filter((v): v is number => v !== null);
      byRegime[regime] = {
        nEngagements: rEngagements,
        nWins: rWins,
        winRate: rEngagements === 0 ? null : rWins / rEngagements,
        ciLow: rEngagements === 0 ? 0 : rci.low,
        ciHigh: rEngagements === 0 ? 0 : rci.high,
        nEngagementsUp: stats.nEngagementsUp,
        nWinsUp: stats.nWinsUp,
        winRateUp:
          stats.nEngagementsUp === 0
            ? null
            : stats.nWinsUp / stats.nEngagementsUp,
        nEngagementsDown: stats.nEngagementsDown,
        nWinsDown: stats.nWinsDown,
        winRateDown:
          stats.nEngagementsDown === 0
            ? null
            : stats.nWinsDown / stats.nEngagementsDown,
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
      nEngagements: b.nEngagements,
      nWins: b.nWins,
      winRate: b.nEngagements === 0 ? null : b.nWins / b.nEngagements,
      ciLow: b.nEngagements === 0 ? 0 : ci.low,
      ciHigh: b.nEngagements === 0 ? 0 : ci.high,
      nEngagementsUp: b.nEngagementsUp,
      nWinsUp: b.nWinsUp,
      winRateUp: b.nEngagementsUp === 0 ? null : b.nWinsUp / b.nEngagementsUp,
      nEngagementsDown: b.nEngagementsDown,
      nWinsDown: b.nWinsDown,
      winRateDown:
        b.nEngagementsDown === 0 ? null : b.nWinsDown / b.nEngagementsDown,
      quarters,
      quarterWinRateMin:
        quarterRates.length === 0 ? null : Math.min(...quarterRates),
      quarterWinRateMax:
        quarterRates.length === 0 ? null : Math.max(...quarterRates),
      family,
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
    return b.nEngagements - a.nEngagements;
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

function familyOf(filterId: string): FilterFamily | null {
  const entry = getFilter(filterId);
  return entry === undefined ? null : entry.filter.family;
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
