import "@alea/lib/filters/all";

import { assetValues } from "@alea/constants/assets";
import { TRADE_DECISION_SUPPORTED_PERIODS } from "@alea/constants/tradeDecision";
import { STAKE_USD } from "@alea/constants/trading";
import { TRAINING_PROFILE_ID } from "@alea/constants/training";
import type {
  BacktestDashboardAssetRow,
  BacktestDashboardCandidateRow,
  BacktestDashboardPayload,
  BacktestDashboardPeriodRow,
  BacktestDashboardPnlPoint,
  BacktestDashboardSummary,
} from "@alea/lib/backtest/dashboard/types";
import type { DatabaseClient } from "@alea/lib/db/types";
import {
  activeCandidateRows,
  candidateRegistryKey,
} from "@alea/lib/filters/activeCandidates";
import { getFilter } from "@alea/lib/filters/registry";
import { sql } from "kysely";

const TOP_CANDIDATE_LIMIT = 30;

type RawFilterRunRow = {
  readonly run_hash: string;
  readonly filter_id: string;
  readonly filter_version: number;
  readonly config_canon: string;
  readonly period: string;
  readonly asset: string;
  readonly range_first_ms: string | number;
  readonly range_last_ms: string | number;
  readonly n_bars: number;
  readonly n_engagements_up: number;
  readonly n_wins_up: number;
  readonly n_engagements_down: number;
  readonly n_wins_down: number;
  readonly computed_at_ms: string | number;
};

type NormalizedRunRow = RawFilterRunRow & {
  readonly rangeFirstMs: number;
  readonly rangeLastMs: number;
  readonly computedAtMs: number;
};

type Aggregate = {
  runCount: number;
  nBars: number;
  nEngagementsUp: number;
  nWinsUp: number;
  nEngagementsDown: number;
  nWinsDown: number;
  rangeFirstMs: number | null;
  rangeLastMs: number | null;
  computedAtMinMs: number | null;
  computedAtMaxMs: number | null;
};

export async function loadBacktestPayload({
  db,
  now = () => Date.now(),
}: {
  readonly db: DatabaseClient;
  readonly now?: () => number;
}): Promise<BacktestDashboardPayload> {
  const rowsRaw = (await db
    .selectFrom("filter_runs")
    .select([
      "run_hash",
      "filter_id",
      "filter_version",
      "config_canon",
      "period",
      "asset",
      "range_first_ms",
      "range_last_ms",
      "n_bars",
      "n_engagements_up",
      "n_wins_up",
      "n_engagements_down",
      "n_wins_down",
      "computed_at_ms",
    ])
    .where("training_profile", "=", TRAINING_PROFILE_ID)
    .execute()) as readonly RawFilterRunRow[];

  const activeCandidates = activeCandidateRows();
  const activeKeys = new Set(activeCandidates.map(candidateRegistryKey));
  const rows = rowsRaw
    .filter((row) =>
      activeKeys.has(
        candidateRegistryKey({
          filterId: row.filter_id,
          filterVersion: row.filter_version,
          configCanon: row.config_canon,
        }),
      ),
    )
    .map(normalizeRow);

  const expectedRunCount =
    activeCandidates.length *
    TRADE_DECISION_SUPPORTED_PERIODS.length *
    assetValues.length;
  const seenRunKeys = new Set(rows.map(runCoverageKey));
  const summary = summaryFromAggregate({
    aggregate: aggregateRows(rows),
    activeCandidateCount: activeCandidates.length,
    activeFilterCount: new Set(activeCandidates.map((c) => c.filterId)).size,
    expectedRunCount,
    runCount: seenRunKeys.size,
    ignoredInactiveRunCount: rowsRaw.length - rows.length,
  });

  return {
    generatedAtMs: now(),
    trainingProfileId: TRAINING_PROFILE_ID,
    supportedPeriods: TRADE_DECISION_SUPPORTED_PERIODS,
    assets: assetValues,
    stakeUsd: STAKE_USD,
    summary,
    byPeriod: buildPeriodRows({
      rows,
      activeCandidateCount: activeCandidates.length,
    }),
    byAsset: buildAssetRows({
      rows,
      activeCandidateCount: activeCandidates.length,
    }),
    topCandidates: buildTopCandidateRows({ rows }),
    pnlSeries: await buildPnlSeries({ db, activeCandidates }),
  };
}

async function buildPnlSeries({
  db,
  activeCandidates,
}: {
  readonly db: DatabaseClient;
  readonly activeCandidates: ReturnType<typeof activeCandidateRows>;
}): Promise<readonly BacktestDashboardPnlPoint[]> {
  if (activeCandidates.length === 0) {
    return [];
  }

  const activeCandidateValues = sql.join(
    activeCandidates.map(
      (candidate) =>
        sql`(${candidate.filterId}::text, ${candidate.filterVersion}::integer, ${candidate.configCanon}::text)`,
    ),
  );
  const rows = await sql<{
    period: string;
    asset: string;
    ts_ms: string;
    n_engagements: string;
    n_wins: string;
  }>`
    with active_candidates(filter_id, filter_version, config_canon) as (
      values ${activeCandidateValues}
    ),
    engagement_days as (
      select
        fr.period,
        fr.asset,
        date_trunc('day', to_timestamp(fe.ts_ms / 1000.0)) as bucket,
        count(*)::text as n_engagements,
        coalesce(sum(fe.won), 0)::text as n_wins
      from filter_runs fr
      join active_candidates ac
        on ac.filter_id = fr.filter_id
        and ac.filter_version = fr.filter_version
        and ac.config_canon = fr.config_canon
      join filter_engagements fe on fe.run_hash = fr.run_hash
      where fr.training_profile = ${TRAINING_PROFILE_ID}
      group by fr.period, fr.asset, bucket
    )
    select
      period,
      asset,
      ((extract(epoch from bucket) * 1000)::bigint)::text as ts_ms,
      n_engagements,
      n_wins
    from engagement_days
    order by period, asset, ts_ms
  `.execute(db);

  return rows.rows.map((row) => {
    const nEngagements = Number(row.n_engagements);
    const nWins = Number(row.n_wins);
    return {
      period: row.period,
      asset: row.asset,
      tsMs: Number(row.ts_ms),
      nEngagements,
      nWins,
      nLosses: nEngagements - nWins,
    };
  });
}

function buildPeriodRows({
  rows,
  activeCandidateCount,
}: {
  readonly rows: readonly NormalizedRunRow[];
  readonly activeCandidateCount: number;
}): readonly BacktestDashboardPeriodRow[] {
  return TRADE_DECISION_SUPPORTED_PERIODS.map((period) => {
    const periodRows = rows.filter((row) => row.period === period);
    const expectedRunCount = activeCandidateCount * assetValues.length;
    const runCount = new Set(periodRows.map(runCoverageKey)).size;
    const aggregate = aggregateRows(periodRows);
    return {
      period,
      expectedRunCount,
      runCount,
      missingRunCount: Math.max(0, expectedRunCount - runCount),
      assetCount: new Set(periodRows.map((row) => row.asset)).size,
      ...aggregateProjection(aggregate),
    };
  });
}

function buildAssetRows({
  rows,
  activeCandidateCount,
}: {
  readonly rows: readonly NormalizedRunRow[];
  readonly activeCandidateCount: number;
}): readonly BacktestDashboardAssetRow[] {
  const out: BacktestDashboardAssetRow[] = [];
  for (const period of TRADE_DECISION_SUPPORTED_PERIODS) {
    for (const asset of assetValues) {
      const assetRows = rows.filter(
        (row) => row.period === period && row.asset === asset,
      );
      const runCount = new Set(assetRows.map(runCoverageKey)).size;
      const aggregate = aggregateRows(assetRows);
      const projection = aggregateProjection(aggregate);
      out.push({
        period,
        asset,
        expectedRunCount: activeCandidateCount,
        runCount,
        missingRunCount: Math.max(0, activeCandidateCount - runCount),
        nBars: projection.nBars,
        nEngagements: projection.nEngagements,
        nWins: projection.nWins,
        winRate: projection.winRate,
        computedAtMaxMs: projection.computedAtMaxMs,
      });
    }
  }
  return out;
}

function buildTopCandidateRows({
  rows,
}: {
  readonly rows: readonly NormalizedRunRow[];
}): readonly BacktestDashboardCandidateRow[] {
  type CandidateBucket = Aggregate & {
    readonly id: string;
    readonly filterId: string;
    readonly filterVersion: number;
    readonly filterFamily: string | null;
    readonly period: string;
    readonly configCanon: string;
    readonly assets: Set<string>;
  };
  const buckets = new Map<string, CandidateBucket>();
  for (const row of rows) {
    const id = [
      row.period,
      row.filter_id,
      row.filter_version,
      row.config_canon,
    ].join("|");
    let bucket = buckets.get(id);
    if (bucket === undefined) {
      bucket = {
        id,
        filterId: row.filter_id,
        filterVersion: row.filter_version,
        filterFamily: getFilter(row.filter_id)?.filter.family ?? null,
        period: row.period,
        configCanon: row.config_canon,
        assets: new Set<string>(),
        ...emptyAggregate(),
      };
      buckets.set(id, bucket);
    }
    bucket.assets.add(row.asset);
    addToAggregate(bucket, row);
  }

  const rowsByCandidate = Array.from(buckets.values()).map((bucket) => {
    const projection = aggregateProjection(bucket);
    return {
      id: bucket.id,
      filterId: bucket.filterId,
      filterVersion: bucket.filterVersion,
      filterFamily: bucket.filterFamily,
      period: bucket.period,
      configCanon: bucket.configCanon,
      assetCount: bucket.assets.size,
      nBars: projection.nBars,
      nEngagements: projection.nEngagements,
      nWins: projection.nWins,
      winRate: projection.winRate,
      upWinRate: projection.upWinRate,
      downWinRate: projection.downWinRate,
      computedAtMaxMs: projection.computedAtMaxMs,
    } satisfies BacktestDashboardCandidateRow;
  });

  return TRADE_DECISION_SUPPORTED_PERIODS.flatMap((period) =>
    rowsByCandidate
      .filter((row) => row.period === period)
      .sort((a, b) => {
        const wrDelta = (b.winRate ?? -1) - (a.winRate ?? -1);
        if (wrDelta !== 0) {
          return wrDelta;
        }
        return b.nEngagements - a.nEngagements;
      })
      .slice(0, TOP_CANDIDATE_LIMIT),
  );
}

function summaryFromAggregate({
  aggregate,
  activeCandidateCount,
  activeFilterCount,
  expectedRunCount,
  runCount,
  ignoredInactiveRunCount,
}: {
  readonly aggregate: Aggregate;
  readonly activeCandidateCount: number;
  readonly activeFilterCount: number;
  readonly expectedRunCount: number;
  readonly runCount: number;
  readonly ignoredInactiveRunCount: number;
}): BacktestDashboardSummary {
  return {
    activeCandidateCount,
    activeFilterCount,
    expectedRunCount,
    runCount,
    missingRunCount: Math.max(0, expectedRunCount - runCount),
    ignoredInactiveRunCount,
    ...aggregateProjection(aggregate),
  };
}

function aggregateRows(rows: readonly NormalizedRunRow[]): Aggregate {
  const aggregate = emptyAggregate();
  for (const row of rows) {
    addToAggregate(aggregate, row);
  }
  return aggregate;
}

function emptyAggregate(): Aggregate {
  return {
    runCount: 0,
    nBars: 0,
    nEngagementsUp: 0,
    nWinsUp: 0,
    nEngagementsDown: 0,
    nWinsDown: 0,
    rangeFirstMs: null,
    rangeLastMs: null,
    computedAtMinMs: null,
    computedAtMaxMs: null,
  };
}

function addToAggregate(aggregate: Aggregate, row: NormalizedRunRow): void {
  aggregate.runCount += 1;
  aggregate.nBars += row.n_bars;
  aggregate.nEngagementsUp += row.n_engagements_up;
  aggregate.nWinsUp += row.n_wins_up;
  aggregate.nEngagementsDown += row.n_engagements_down;
  aggregate.nWinsDown += row.n_wins_down;
  aggregate.rangeFirstMs =
    aggregate.rangeFirstMs === null
      ? row.rangeFirstMs
      : Math.min(aggregate.rangeFirstMs, row.rangeFirstMs);
  aggregate.rangeLastMs =
    aggregate.rangeLastMs === null
      ? row.rangeLastMs
      : Math.max(aggregate.rangeLastMs, row.rangeLastMs);
  aggregate.computedAtMinMs =
    aggregate.computedAtMinMs === null
      ? row.computedAtMs
      : Math.min(aggregate.computedAtMinMs, row.computedAtMs);
  aggregate.computedAtMaxMs =
    aggregate.computedAtMaxMs === null
      ? row.computedAtMs
      : Math.max(aggregate.computedAtMaxMs, row.computedAtMs);
}

function aggregateProjection(
  aggregate: Aggregate,
): Omit<
  BacktestDashboardSummary,
  | "activeCandidateCount"
  | "activeFilterCount"
  | "expectedRunCount"
  | "runCount"
  | "missingRunCount"
  | "ignoredInactiveRunCount"
> {
  const nEngagements = aggregate.nEngagementsUp + aggregate.nEngagementsDown;
  const nWins = aggregate.nWinsUp + aggregate.nWinsDown;
  return {
    nBars: aggregate.nBars,
    nEngagements,
    nWins,
    winRate: ratio({ numerator: nWins, denominator: nEngagements }),
    nEngagementsUp: aggregate.nEngagementsUp,
    nWinsUp: aggregate.nWinsUp,
    upWinRate: ratio({
      numerator: aggregate.nWinsUp,
      denominator: aggregate.nEngagementsUp,
    }),
    nEngagementsDown: aggregate.nEngagementsDown,
    nWinsDown: aggregate.nWinsDown,
    downWinRate: ratio({
      numerator: aggregate.nWinsDown,
      denominator: aggregate.nEngagementsDown,
    }),
    rangeFirstMs: aggregate.rangeFirstMs,
    rangeLastMs: aggregate.rangeLastMs,
    computedAtMinMs: aggregate.computedAtMinMs,
    computedAtMaxMs: aggregate.computedAtMaxMs,
  };
}

function normalizeRow(row: RawFilterRunRow): NormalizedRunRow {
  return {
    ...row,
    rangeFirstMs: Number(row.range_first_ms),
    rangeLastMs: Number(row.range_last_ms),
    computedAtMs: Number(row.computed_at_ms),
  };
}

function runCoverageKey(row: NormalizedRunRow): string {
  return [
    candidateRegistryKey({
      filterId: row.filter_id,
      filterVersion: row.filter_version,
      configCanon: row.config_canon,
    }),
    row.period,
    row.asset,
  ].join("|");
}

function ratio({
  numerator,
  denominator,
}: {
  readonly numerator: number;
  readonly denominator: number;
}): number | null {
  return denominator === 0 ? null : numerator / denominator;
}
