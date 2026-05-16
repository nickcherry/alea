import { CANDIDATE_BACKTEST_PERIODS } from "@alea/constants/backtest";
import type {
  BacktestDashboardCandidateRow,
  BacktestDashboardPayload,
  BacktestDashboardPeriodSlice,
  BacktestDashboardQuarterCell,
} from "@alea/lib/backtest/dashboard/types";
import type { DatabaseClient } from "@alea/lib/db/types";

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
    ])
    .execute()) as readonly BacktestRow[];

  const byPeriod: Record<string, BacktestDashboardPeriodSlice> = {};
  for (const period of CANDIDATE_BACKTEST_PERIODS) {
    byPeriod[period] = buildPeriodSlice({
      period,
      rows: rows.filter((row) => row.timeframe === period),
    });
  }

  return {
    generatedAtMs: now(),
    defaultPeriod: defaultPeriodFor({ byPeriod }),
    supportedPeriods: CANDIDATE_BACKTEST_PERIODS,
    byPeriod,
  };
}

function defaultPeriodFor({
  byPeriod,
}: {
  readonly byPeriod: Record<string, BacktestDashboardPeriodSlice>;
}): string {
  if ((byPeriod["15m"]?.rows.length ?? 0) > 0) {
    return "15m";
  }
  if ((byPeriod["5m"]?.rows.length ?? 0) > 0) {
    return "5m";
  }
  return "15m";
}

function buildPeriodSlice({
  period,
  rows,
}: {
  readonly period: string;
  readonly rows: readonly BacktestRow[];
}): BacktestDashboardPeriodSlice {
  const quarters = [
    ...new Map(
      rows
        .map(
          (row) => [Number(row.quarter_start_ms), row.quarter_label] as const,
        )
        .sort((a, b) => a[0] - b[0]),
    ).values(),
  ];
  const candidates = new Map<string, CandidateAccumulator>();
  for (const row of rows) {
    const acc = candidates.get(row.candidate_id) ?? {
      candidateId: row.candidate_id,
      filterId: row.filter_id,
      filterName: row.filter_name,
      filterVersion: row.filter_version,
      configHash: row.config_hash,
      config: row.config_json,
      assets: new Set<string>(),
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
    acc.assets.add(row.asset);
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
        configHash: acc.configHash,
        config: acc.config,
        assetCount: acc.assets.size,
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

  return { period, quarters, rows: candidateRows };
}

type CandidateAccumulator = {
  readonly candidateId: string;
  readonly filterId: string;
  readonly filterName: string;
  readonly filterVersion: number;
  readonly configHash: string;
  readonly config: unknown;
  readonly assets: Set<string>;
  evaluatedCount: number;
  decisionCount: number;
  winCount: number;
  lossCount: number;
  neutralCount: number;
  readonly quarters: Map<string, { decisionCount: number; winCount: number }>;
};
