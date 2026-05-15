import "@alea/lib/filters/all";

import { createHash } from "node:crypto";

import { TRAINING_PROFILE_ID } from "@alea/constants/training";
import type { DatabaseClient } from "@alea/lib/db/types";
import { loadQuarterAggregates } from "@alea/lib/exploration/loadQuarterAggregates";
import { loadRegimeAggregates } from "@alea/lib/exploration/loadRegimeAggregates";
import type {
  ExplorationAssetStats,
  ExplorationCandidateRow,
  ExplorationPayload,
  ExplorationQuarter,
  ExplorationStatsCell,
} from "@alea/lib/exploration/types";
import { wilsonInterval95 } from "@alea/lib/exploration/wilsonInterval";
import {
  activeCandidateKeys,
  activeCandidateRows,
  candidateRegistryKey,
} from "@alea/lib/filters/activeCandidates";
import { canonicalJson } from "@alea/lib/filters/hash";
import { getFilter } from "@alea/lib/filters/registry";
import type { FilterFamily } from "@alea/lib/filters/types";
import { sql } from "kysely";

const EXPLORATION_PAYLOAD_CACHE_SCHEMA_VERSION = 2;

/**
 * Loads every active-profile row in `filter_runs`, then collapses across
 * `asset` so the dashboard shows one row per (filter, version, config, period).
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
  const cacheKey = await loadExplorationPayloadCacheKey({ db });
  const cached = await loadCachedExplorationPayload({ db, cacheKey, now });
  if (cached !== null) {
    return cached;
  }

  const payload = await buildExplorationPayload({ db, now });
  await persistExplorationPayloadCache({ db, cacheKey, payload });
  return payload;
}

async function buildExplorationPayload({
  db,
  now,
}: {
  readonly db: DatabaseClient;
  readonly now: () => number;
}): Promise<ExplorationPayload> {
  const [rawPerAssetRows, quarterRows, regimeRows] = await Promise.all([
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
      .where("training_profile", "=", TRAINING_PROFILE_ID)
      .execute(),
    loadQuarterAggregates({ db }),
    loadRegimeAggregates({ db }),
  ]);
  const activeKeys = activeCandidateKeys();
  const perAssetRows = rawPerAssetRows.filter((r) =>
    activeKeys.has(
      candidateRegistryKey({
        filterId: r.filter_id,
        filterVersion: r.filter_version,
        configCanon: r.config_canon,
      }),
    ),
  );

  // Map run_hash -> (bucketKey, asset). run_hash is unique per
  // (filter, version, config, period, asset), so quarter / regime
  // aggregate rows (which carry only run_hash) get fully attributed
  // back to both the bucket and the asset sub-bucket.
  const runHashToBucketKey = new Map<string, string>();
  const runHashToAsset = new Map<string, string>();
  for (const r of perAssetRows) {
    runHashToBucketKey.set(r.run_hash, bucketKey(r));
    runHashToAsset.set(r.run_hash, r.asset);
  }

  // Aggregate per-asset rows into per-bucket totals. The cross-product
  // (asset × regime × quarter) is kept so the dashboard can compose
  // an asset filter with the existing regime filter without re-querying.
  type CellTotals = {
    nEngagementsUp: number;
    nWinsUp: number;
    nEngagementsDown: number;
    nWinsDown: number;
    quartersByLabel: Map<string, QuarterTotals>;
  };
  type QuarterTotals = {
    year: number;
    quarter: number;
    nEngagements: number;
    nWins: number;
  };
  type AssetBucket = CellTotals & {
    regimes: Map<string, CellTotals>;
  };
  type Bucket = CellTotals & {
    filterId: string;
    filterVersion: number;
    config: unknown;
    configCanon: string;
    period: string;
    nBars: number; // max across assets — informational, not summed
    regimes: Map<string, CellTotals>;
    assets: Map<string, AssetBucket>;
  };

  const newCellTotals = (): CellTotals => ({
    nEngagementsUp: 0,
    nWinsUp: 0,
    nEngagementsDown: 0,
    nWinsDown: 0,
    quartersByLabel: new Map(),
  });
  const newAssetBucket = (): AssetBucket => ({
    ...newCellTotals(),
    regimes: new Map(),
  });

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
        ...newCellTotals(),
        regimes: new Map(),
        assets: new Map(),
      };
      buckets.set(key, b);
    }
    b.nBars = Math.max(b.nBars, r.n_bars);
    b.nEngagementsUp += r.n_engagements_up;
    b.nWinsUp += r.n_wins_up;
    b.nEngagementsDown += r.n_engagements_down;
    b.nWinsDown += r.n_wins_down;

    let ab = b.assets.get(r.asset);
    if (ab === undefined) {
      ab = newAssetBucket();
      b.assets.set(r.asset, ab);
    }
    ab.nEngagementsUp += r.n_engagements_up;
    ab.nWinsUp += r.n_wins_up;
    ab.nEngagementsDown += r.n_engagements_down;
    ab.nWinsDown += r.n_wins_down;
  }

  const accumulateQuarter = (
    target: Map<string, QuarterTotals>,
    year: number,
    quarter: number,
    nEngagements: number,
    nWins: number,
  ): void => {
    const label = `${year}-Q${quarter}`;
    let qb = target.get(label);
    if (qb === undefined) {
      qb = { year, quarter, nEngagements: 0, nWins: 0 };
      target.set(label, qb);
    }
    qb.nEngagements += nEngagements;
    qb.nWins += nWins;
  };

  // Fold quarter aggregates into their buckets. Each (run_hash, year,
  // quarter) row contributes to one bucket's quarter total AND to the
  // bucket's per-asset quarter total.
  for (const q of quarterRows) {
    const key = runHashToBucketKey.get(q.run_hash);
    const asset = runHashToAsset.get(q.run_hash);
    if (key === undefined || asset === undefined) {
      continue;
    }
    const b = buckets.get(key);
    if (b === undefined) {
      continue;
    }
    accumulateQuarter(
      b.quartersByLabel,
      q.year,
      q.quarter,
      q.n_engagements,
      q.n_wins,
    );
    const ab = b.assets.get(asset);
    if (ab !== undefined) {
      accumulateQuarter(
        ab.quartersByLabel,
        q.year,
        q.quarter,
        q.n_engagements,
        q.n_wins,
      );
    }
  }

  // Fold per-(run_hash, market_regime, direction, year, quarter) rows
  // into buckets. Each row contributes to (i) the all-assets regime
  // total, (ii) the per-asset regime total, and (iii) each one's
  // quarter strip. The four-axis fan-out is the price of letting the
  // dashboard compose asset + regime filters without going back to
  // the database.
  for (const rr of regimeRows) {
    const key = runHashToBucketKey.get(rr.run_hash);
    const asset = runHashToAsset.get(rr.run_hash);
    if (key === undefined || asset === undefined) {
      continue;
    }
    const b = buckets.get(key);
    if (b === undefined) {
      continue;
    }
    let rb = b.regimes.get(rr.market_regime);
    if (rb === undefined) {
      rb = newCellTotals();
      b.regimes.set(rr.market_regime, rb);
    }
    const ab = b.assets.get(asset);
    let arb: CellTotals | undefined;
    if (ab !== undefined) {
      arb = ab.regimes.get(rr.market_regime);
      if (arb === undefined) {
        arb = newCellTotals();
        ab.regimes.set(rr.market_regime, arb);
      }
    }
    if (rr.direction === "u") {
      rb.nEngagementsUp += rr.n_engagements;
      rb.nWinsUp += rr.n_wins;
      if (arb !== undefined) {
        arb.nEngagementsUp += rr.n_engagements;
        arb.nWinsUp += rr.n_wins;
      }
    } else {
      rb.nEngagementsDown += rr.n_engagements;
      rb.nWinsDown += rr.n_wins;
      if (arb !== undefined) {
        arb.nEngagementsDown += rr.n_engagements;
        arb.nWinsDown += rr.n_wins;
      }
    }
    accumulateQuarter(
      rb.quartersByLabel,
      rr.year,
      rr.quarter,
      rr.n_engagements,
      rr.n_wins,
    );
    if (arb !== undefined) {
      accumulateQuarter(
        arb.quartersByLabel,
        rr.year,
        rr.quarter,
        rr.n_engagements,
        rr.n_wins,
      );
    }
  }

  const enriched: ExplorationCandidateRow[] = [];
  for (const [id, b] of buckets.entries()) {
    const family = familyOf(b.filterId);
    if (family === null) {
      // Filter row exists in `filter_runs` but the file isn't
      // registered (deleted but rows not yet purged). Skip — it
      // shouldn't appear on the dashboard.
      continue;
    }
    const topLevel = buildStatsCell(b);
    const byRegime: Record<string, ExplorationStatsCell> = {};
    for (const [regime, stats] of b.regimes.entries()) {
      byRegime[regime] = buildStatsCell(stats);
    }
    const byAsset: Record<string, ExplorationAssetStats> = {};
    for (const [asset, stats] of b.assets.entries()) {
      const assetCell = buildStatsCell(stats);
      const assetByRegime: Record<string, ExplorationStatsCell> = {};
      for (const [regime, regimeStats] of stats.regimes.entries()) {
        assetByRegime[regime] = buildStatsCell(regimeStats);
      }
      byAsset[asset] = { ...assetCell, byRegime: assetByRegime };
    }
    enriched.push({
      id,
      filterId: b.filterId,
      filterVersion: b.filterVersion,
      config: b.config,
      configCanon: b.configCanon,
      period: b.period as ExplorationCandidateRow["period"],
      nBars: b.nBars,
      ...topLevel,
      family,
      // The browser does not render peer overlaps today. Keeping this
      // empty preserves the payload shape without running the exact
      // co-engagement self-join that dominated dashboard build time.
      topPeers: [],
      byRegime,
      byAsset,
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

type ExplorationPayloadCacheKey = {
  readonly schemaVersion: number;
  readonly trainingProfile: string;
  readonly activeCandidateFingerprint: string;
  readonly filterRunsFingerprint: string;
  readonly barRegimesFingerprint: string;
};

async function loadExplorationPayloadCacheKey({
  db,
}: {
  readonly db: DatabaseClient;
}): Promise<ExplorationPayloadCacheKey> {
  const [filterRunsFingerprint, barRegimesFingerprint] = await Promise.all([
    loadFilterRunsFingerprint({ db }),
    loadBarRegimesFingerprint({ db }),
  ]);

  return {
    schemaVersion: EXPLORATION_PAYLOAD_CACHE_SCHEMA_VERSION,
    trainingProfile: TRAINING_PROFILE_ID,
    activeCandidateFingerprint: hashString(
      canonicalJson(
        [...activeCandidateRows()].sort((a, b) => {
          const aKey = candidateRegistryKey({
            filterId: a.filterId,
            filterVersion: a.filterVersion,
            configCanon: a.configCanon,
          });
          const bKey = candidateRegistryKey({
            filterId: b.filterId,
            filterVersion: b.filterVersion,
            configCanon: b.configCanon,
          });
          return aKey.localeCompare(bKey);
        }),
      ),
    ),
    filterRunsFingerprint,
    barRegimesFingerprint,
  };
}

async function loadCachedExplorationPayload({
  db,
  cacheKey,
  now,
}: {
  readonly db: DatabaseClient;
  readonly cacheKey: ExplorationPayloadCacheKey;
  readonly now: () => number;
}): Promise<ExplorationPayload | null> {
  const row = await db
    .selectFrom("exploration_payload_cache")
    .select(["payload"])
    .where("training_profile", "=", cacheKey.trainingProfile)
    .where("schema_version", "=", cacheKey.schemaVersion)
    .where(
      "active_candidate_fingerprint",
      "=",
      cacheKey.activeCandidateFingerprint,
    )
    .where("filter_runs_fingerprint", "=", cacheKey.filterRunsFingerprint)
    .where("bar_regimes_fingerprint", "=", cacheKey.barRegimesFingerprint)
    .executeTakeFirst();

  if (row === undefined || !isExplorationPayload(row.payload)) {
    return null;
  }
  return { ...row.payload, generatedAtMs: now() };
}

async function persistExplorationPayloadCache({
  db,
  cacheKey,
  payload,
}: {
  readonly db: DatabaseClient;
  readonly cacheKey: ExplorationPayloadCacheKey;
  readonly payload: ExplorationPayload;
}): Promise<void> {
  const computedAtMs = Date.now();
  await db
    .insertInto("exploration_payload_cache")
    .values({
      training_profile: cacheKey.trainingProfile,
      schema_version: cacheKey.schemaVersion,
      active_candidate_fingerprint: cacheKey.activeCandidateFingerprint,
      filter_runs_fingerprint: cacheKey.filterRunsFingerprint,
      bar_regimes_fingerprint: cacheKey.barRegimesFingerprint,
      payload,
      computed_at_ms: computedAtMs,
    })
    .onConflict((oc) =>
      oc.column("training_profile").doUpdateSet({
        schema_version: cacheKey.schemaVersion,
        active_candidate_fingerprint: cacheKey.activeCandidateFingerprint,
        filter_runs_fingerprint: cacheKey.filterRunsFingerprint,
        bar_regimes_fingerprint: cacheKey.barRegimesFingerprint,
        payload,
        computed_at_ms: computedAtMs,
      }),
    )
    .execute();
}

async function loadFilterRunsFingerprint({
  db,
}: {
  readonly db: DatabaseClient;
}): Promise<string> {
  const rows = await sql<{ fingerprint: string }>`
    select coalesce(
      md5(string_agg(
        fr.run_hash || ':' ||
        fr.filter_id || ':' ||
        fr.filter_version::text || ':' ||
        fr.config_canon || ':' ||
        fr.period || ':' ||
        fr.asset || ':' ||
        fr.range_first_ms::text || ':' ||
        fr.range_last_ms::text || ':' ||
        fr.n_bars::text || ':' ||
        fr.n_engagements_up::text || ':' ||
        fr.n_wins_up::text || ':' ||
        fr.n_engagements_down::text || ':' ||
        fr.n_wins_down::text || ':' ||
        fr.computed_at_ms::text,
        ',' order by fr.run_hash
      )),
      'empty'
    ) as fingerprint
    from filter_runs fr
    where fr.training_profile = ${TRAINING_PROFILE_ID}
  `.execute(db);
  return rows.rows[0]?.fingerprint ?? "empty";
}

async function loadBarRegimesFingerprint({
  db,
}: {
  readonly db: DatabaseClient;
}): Promise<string> {
  const rows = await sql<{ fingerprint: string }>`
    with grouped as (
      select
        br.asset,
        br.period,
        coalesce(br.market_regime, 'null') as market_regime,
        count(*)::text as n_rows,
        min(br.ts_ms)::text as min_ts_ms,
        max(br.ts_ms)::text as max_ts_ms,
        sum((br.ts_ms % 1000000007))::text as ts_checksum
      from bar_regimes br
      group by br.asset, br.period, coalesce(br.market_regime, 'null')
    )
    select coalesce(
      md5(string_agg(
        asset || ':' ||
        period || ':' ||
        market_regime || ':' ||
        n_rows || ':' ||
        min_ts_ms || ':' ||
        max_ts_ms || ':' ||
        ts_checksum,
        ',' order by asset, period, market_regime
      )),
      'empty'
    ) as fingerprint
    from grouped
  `.execute(db);
  return rows.rows[0]?.fingerprint ?? "empty";
}

function isExplorationPayload(value: unknown): value is ExplorationPayload {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<ExplorationPayload>;
  return (
    typeof candidate.generatedAtMs === "number" &&
    typeof candidate.rowCount === "number" &&
    Array.isArray(candidate.rows)
  );
}

function hashString(value: string): string {
  return createHash("sha256").update(value).digest("hex");
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

type QuarterTotalsForCell = {
  readonly year: number;
  readonly quarter: number;
  readonly nEngagements: number;
  readonly nWins: number;
};
type CellTotalsForCell = {
  readonly nEngagementsUp: number;
  readonly nWinsUp: number;
  readonly nEngagementsDown: number;
  readonly nWinsDown: number;
  readonly quartersByLabel: ReadonlyMap<string, QuarterTotalsForCell>;
};

function buildStatsCell(cell: CellTotalsForCell): ExplorationStatsCell {
  const nEngagements = cell.nEngagementsUp + cell.nEngagementsDown;
  const nWins = cell.nWinsUp + cell.nWinsDown;
  const ci = wilsonInterval95({ wins: nWins, n: nEngagements });
  const quarters: ExplorationQuarter[] = Array.from(cell.quartersByLabel.entries())
    .map(([label, qb]) => ({
      label,
      year: qb.year,
      quarter: qb.quarter,
      nEngagements: qb.nEngagements,
      nWins: qb.nWins,
      winRate: qb.nEngagements === 0 ? null : qb.nWins / qb.nEngagements,
    }))
    .sort((a, b) => (a.year !== b.year ? a.year - b.year : a.quarter - b.quarter));
  const quarterRates = quarters
    .map((q) => q.winRate)
    .filter((v): v is number => v !== null);
  return {
    nEngagements,
    nWins,
    winRate: nEngagements === 0 ? null : nWins / nEngagements,
    ciLow: nEngagements === 0 ? 0 : ci.low,
    ciHigh: nEngagements === 0 ? 0 : ci.high,
    nEngagementsUp: cell.nEngagementsUp,
    nWinsUp: cell.nWinsUp,
    winRateUp:
      cell.nEngagementsUp === 0 ? null : cell.nWinsUp / cell.nEngagementsUp,
    nEngagementsDown: cell.nEngagementsDown,
    nWinsDown: cell.nWinsDown,
    winRateDown:
      cell.nEngagementsDown === 0 ? null : cell.nWinsDown / cell.nEngagementsDown,
    quarters,
    quarterWinRateMin:
      quarterRates.length === 0 ? null : Math.min(...quarterRates),
    quarterWinRateMax:
      quarterRates.length === 0 ? null : Math.max(...quarterRates),
  };
}
