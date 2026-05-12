export type BacktestDashboardSummary = {
  readonly activeCandidateCount: number;
  readonly activeFilterCount: number;
  readonly expectedRunCount: number;
  readonly runCount: number;
  readonly missingRunCount: number;
  readonly ignoredInactiveRunCount: number;
  readonly nBars: number;
  readonly nEngagements: number;
  readonly nWins: number;
  readonly winRate: number | null;
  readonly nEngagementsUp: number;
  readonly nWinsUp: number;
  readonly upWinRate: number | null;
  readonly nEngagementsDown: number;
  readonly nWinsDown: number;
  readonly downWinRate: number | null;
  readonly rangeFirstMs: number | null;
  readonly rangeLastMs: number | null;
  readonly computedAtMinMs: number | null;
  readonly computedAtMaxMs: number | null;
};

export type BacktestDashboardPeriodRow = {
  readonly period: string;
  readonly expectedRunCount: number;
  readonly runCount: number;
  readonly missingRunCount: number;
  readonly assetCount: number;
  readonly nBars: number;
  readonly nEngagements: number;
  readonly nWins: number;
  readonly winRate: number | null;
  readonly computedAtMinMs: number | null;
  readonly computedAtMaxMs: number | null;
  readonly rangeFirstMs: number | null;
  readonly rangeLastMs: number | null;
};

export type BacktestDashboardAssetRow = {
  readonly period: string;
  readonly asset: string;
  readonly expectedRunCount: number;
  readonly runCount: number;
  readonly missingRunCount: number;
  readonly nBars: number;
  readonly nEngagements: number;
  readonly nWins: number;
  readonly winRate: number | null;
  readonly computedAtMaxMs: number | null;
};

export type BacktestDashboardCandidateRow = {
  readonly id: string;
  readonly filterId: string;
  readonly filterVersion: number;
  readonly filterFamily: string | null;
  readonly period: string;
  readonly configCanon: string;
  readonly assetCount: number;
  readonly nBars: number;
  readonly nEngagements: number;
  readonly nWins: number;
  readonly winRate: number | null;
  readonly upWinRate: number | null;
  readonly downWinRate: number | null;
  readonly computedAtMaxMs: number | null;
};

export type BacktestDashboardPnlPoint = {
  readonly period: string;
  readonly asset: string;
  readonly tsMs: number;
  readonly nEngagements: number;
  readonly nWins: number;
  readonly nLosses: number;
};

export type BacktestDashboardPayload = {
  readonly generatedAtMs: number;
  readonly trainingProfileId: string;
  readonly supportedPeriods: readonly string[];
  readonly assets: readonly string[];
  readonly stakeUsd: number;
  readonly summary: BacktestDashboardSummary;
  readonly byPeriod: readonly BacktestDashboardPeriodRow[];
  readonly byAsset: readonly BacktestDashboardAssetRow[];
  readonly topCandidates: readonly BacktestDashboardCandidateRow[];
  readonly pnlSeries: readonly BacktestDashboardPnlPoint[];
};
