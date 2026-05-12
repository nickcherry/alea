import "@alea/lib/filters/all";

import { createHash } from "node:crypto";

import { TRAINING_PROFILE_ID } from "@alea/constants/training";
import type { DatabaseClient } from "@alea/lib/db/types";
import { loadQuarterAggregates } from "@alea/lib/exploration/loadQuarterAggregates";
import { loadRegimeAggregates } from "@alea/lib/exploration/loadRegimeAggregates";
import type {
  ExplorationCandidateRow,
  ExplorationPayload,
  ExplorationQuarter,
  ExplorationRegimeStats,
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

const EXPLORATION_PAYLOAD_CACHE_SCHEMA_VERSION = 1;

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
      // The browser does not render peer overlaps today. Keeping this
      // empty preserves the payload shape without running the exact
      // co-engagement self-join that dominated dashboard build time.
      topPeers: [],
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
