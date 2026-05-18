import {
  CANDIDATE_BACKTEST_ASSETS,
  CANDIDATE_BACKTEST_PERIODS,
} from "@alea/constants/backtest";
import type { TradeDecisionPeriod } from "@alea/constants/tradeDecision";
import type {
  BacktestDashboardAssetSlice,
  BacktestDashboardCandidateRow,
  BacktestDashboardPayload,
  BacktestDashboardPeriodSlice,
  BacktestDashboardQuarterCell,
} from "@alea/lib/backtest/dashboard/types";
import type { DatabaseClient } from "@alea/lib/db/types";
import {
  registeredCandidates,
  registeredCandidatesForMarket,
} from "@alea/lib/filters/registry";
import type { Asset } from "@alea/types/assets";

type BacktestRow = {
  readonly candidate_id: string;
  readonly filter_id: string;
  readonly filter_name: string;
  readonly filter_version: number;
  readonly config_hash: string;
  readonly config_json: unknown;
  readonly asset: string;
  readonly timeframe: string;
  readonly quarter_start_ms: string | number;
  readonly quarter_label: string;
  readonly evaluated_count: number;
  readonly decision_count: number;
  readonly win_count: number;
  readonly loss_count: number;
  readonly neutral_count: number;
  readonly take_profit_pct: number;
  readonly stop_loss_pct: number;
};

export async function loadBacktestPayload({
  db,
  now = () => Date.now(),
}: {
  readonly db: DatabaseClient;
  readonly now?: () => number;
}): Promise<BacktestDashboardPayload> {
  const rows = (await db
    .selectFrom("candidate_backtest_quarter_results")
    .select([
      "candidate_id",
      "filter_id",
      "filter_name",
      "filter_version",
      "config_hash",
      "config_json",
      "asset",
      "timeframe",
      "quarter_start_ms",
      "quarter_label",
      "evaluated_count",
      "decision_count",
      "win_count",
      "loss_count",
      "neutral_count",
      "take_profit_pct",
      "stop_loss_pct",
    ])
    .execute()) as readonly BacktestRow[];

  const descriptionByFilterId = new Map(
    registeredCandidates.map((c) => [c.filterId, c.description]),
  );
  const byPeriod: Record<string, BacktestDashboardPeriodSlice> = {};
  for (const period of CANDIDATE_BACKTEST_PERIODS) {
    byPeriod[period] = buildPeriodSlice({
      period,
      rows,
      descriptionByFilterId,
    });
  }

  return {
    generatedAtMs: now(),
    defaultPeriod: defaultPeriodFor({ byPeriod }),
    defaultAsset: defaultAssetFor({ byPeriod }),
    supportedPeriods: CANDIDATE_BACKTEST_PERIODS,
    supportedAssets: CANDIDATE_BACKTEST_ASSETS,
    byPeriod,
  };
}

function defaultAssetFor({
  byPeriod,
}: {
  readonly byPeriod: Record<string, BacktestDashboardPeriodSlice>;
}): string {
  for (const period of CANDIDATE_BACKTEST_PERIODS) {
    const slice = byPeriod[period];
    if (slice === undefined) {
      continue;
    }
    for (const asset of CANDIDATE_BACKTEST_ASSETS) {
      if ((slice.byAsset[asset]?.rows.length ?? 0) > 0) {
        return asset;
      }
    }
  }
  return CANDIDATE_BACKTEST_ASSETS[0] ?? "btc";
}

function periodHasRows(
  slice: BacktestDashboardPeriodSlice | undefined,
): boolean {
  return Object.values(slice?.byAsset ?? {}).some(
    (assetSlice) => assetSlice.rows.length > 0,
  );
}

function defaultPeriodFor({
  byPeriod,
}: {
  readonly byPeriod: Record<string, BacktestDashboardPeriodSlice>;
}): string {
  for (const period of CANDIDATE_BACKTEST_PERIODS) {
    if (periodHasRows(byPeriod[period])) {
      return period;
    }
  }
  return CANDIDATE_BACKTEST_PERIODS[0] ?? "1h";
}

function buildPeriodSlice({
  period,
  rows,
  descriptionByFilterId,
}: {
  readonly period: TradeDecisionPeriod;
  readonly rows: readonly BacktestRow[];
  readonly descriptionByFilterId: ReadonlyMap<string, string>;
}): BacktestDashboardPeriodSlice {
  const byAsset: Record<string, BacktestDashboardAssetSlice> = {};
  const periodRows = rows.filter((row) => row.timeframe === period);
  const quarters = quarterLabelsFor({ rows: periodRows });
  for (const asset of CANDIDATE_BACKTEST_ASSETS) {
    const activeCandidateIds = new Set(
      registeredCandidatesForMarket({ period, asset }).map(
        (candidate) => candidate.id,
      ),
    );
    byAsset[asset] = buildAssetSlice({
      period,
      asset,
      quarters,
      descriptionByFilterId,
      rows: rows.filter(
        (row) =>
          row.asset === asset &&
          row.timeframe === period &&
          activeCandidateIds.has(row.candidate_id),
      ),
    });
  }
  return {
    period,
    defaultAsset: defaultAssetForPeriod({ byAsset }),
    supportedAssets: CANDIDATE_BACKTEST_ASSETS,
    byAsset,
  };
}

function defaultAssetForPeriod({
  byAsset,
}: {
  readonly byAsset: Record<string, BacktestDashboardAssetSlice>;
}): string {
  return (
    CANDIDATE_BACKTEST_ASSETS.find(
      (asset) => (byAsset[asset]?.rows.length ?? 0) > 0,
    ) ??
    CANDIDATE_BACKTEST_ASSETS[0] ??
    "btc"
  );
}

function buildAssetSlice({
  period,
  asset,
  quarters,
  rows,
  descriptionByFilterId,
}: {
  readonly period: TradeDecisionPeriod;
  readonly asset: Asset;
  readonly quarters: readonly string[];
  readonly rows: readonly BacktestRow[];
  readonly descriptionByFilterId: ReadonlyMap<string, string>;
}): BacktestDashboardAssetSlice {
  const candidates = new Map<string, CandidateAccumulator>();
  for (const row of rows) {
    const acc = candidates.get(row.candidate_id) ?? {
      candidateId: row.candidate_id,
      filterId: row.filter_id,
      filterName: row.filter_name,
      filterVersion: row.filter_version,
      filterDescription: descriptionByFilterId.get(row.filter_id) ?? "",
      configHash: row.config_hash,
      config: row.config_json,
      takeProfitPct: Number(row.take_profit_pct),
      stopLossPct: Number(row.stop_loss_pct),
      evaluatedCount: 0,
      decisionCount: 0,
      winCount: 0,
      lossCount: 0,
      neutralCount: 0,
      quarters: new Map<
        string,
        {
          decisionCount: number;
          winCount: number;
        }
      >(),
    };
    acc.evaluatedCount += row.evaluated_count;
    acc.decisionCount += row.decision_count;
    acc.winCount += row.win_count;
    acc.lossCount += row.loss_count;
    acc.neutralCount += row.neutral_count;
    const q = acc.quarters.get(row.quarter_label) ?? {
      decisionCount: 0,
      winCount: 0,
    };
    q.decisionCount += row.decision_count;
    q.winCount += row.win_count;
    acc.quarters.set(row.quarter_label, q);
    candidates.set(row.candidate_id, acc);
  }

  const candidateRows = [...candidates.values()]
    .map((acc): BacktestDashboardCandidateRow => {
      const quarterCells: BacktestDashboardQuarterCell[] = quarters.map(
        (label) => {
          const q = acc.quarters.get(label);
          if (q === undefined || q.decisionCount === 0) {
            return {
              label,
              decisionCount: 0,
              winCount: 0,
              winRate: null,
            };
          }
          return {
            label,
            decisionCount: q.decisionCount,
            winCount: q.winCount,
            winRate: q.winCount / q.decisionCount,
          };
        },
      );
      return {
        candidateId: acc.candidateId,
        filterId: acc.filterId,
        filterName: acc.filterName,
        filterVersion: acc.filterVersion,
        filterDescription: acc.filterDescription,
        configHash: acc.configHash,
        config: acc.config,
        takeProfitPct: acc.takeProfitPct,
        stopLossPct: acc.stopLossPct,
        evaluatedCount: acc.evaluatedCount,
        decisionCount: acc.decisionCount,
        winCount: acc.winCount,
        lossCount: acc.lossCount,
        neutralCount: acc.neutralCount,
        winRate:
          acc.decisionCount === 0 ? null : acc.winCount / acc.decisionCount,
        quarters: quarterCells,
      };
    })
    .sort((a, b) => {
      const aWr = a.winRate ?? -1;
      const bWr = b.winRate ?? -1;
      return (
        bWr - aWr ||
        b.decisionCount - a.decisionCount ||
        a.filterName.localeCompare(b.filterName)
      );
    });

  return { period, asset, quarters, rows: candidateRows };
}

function quarterLabelsFor({
  rows,
}: {
  readonly rows: readonly BacktestRow[];
}): readonly string[] {
  return [
    ...new Map(
      rows
        .map(
          (row) => [Number(row.quarter_start_ms), row.quarter_label] as const,
        )
        .sort((a, b) => a[0] - b[0]),
    ).values(),
  ];
}

type CandidateAccumulator = {
  readonly candidateId: string;
  readonly filterId: string;
  readonly filterName: string;
  readonly filterVersion: number;
  readonly filterDescription: string;
  readonly configHash: string;
  readonly config: unknown;
  readonly takeProfitPct: number;
  readonly stopLossPct: number;
  evaluatedCount: number;
  decisionCount: number;
  winCount: number;
  lossCount: number;
  neutralCount: number;
  readonly quarters: Map<string, { decisionCount: number; winCount: number }>;
};
