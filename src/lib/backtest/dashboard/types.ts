export type BacktestDashboardQuarterCell = {
  readonly label: string;
  readonly decisionCount: number;
  readonly winCount: number;
  readonly winRate: number | null;
};

export type BacktestDashboardCandidateRow = {
  readonly candidateId: string;
  readonly filterId: string;
  readonly filterName: string;
  readonly filterVersion: number;
  readonly filterDescription: string;
  readonly configHash: string;
  readonly config: unknown;
  readonly takeProfitPct: number;
  readonly stopLossPct: number;
  readonly outcomeWindowBars: number;
  readonly evaluatedCount: number;
  readonly decisionCount: number;
  readonly winCount: number;
  readonly lossCount: number;
  readonly neutralCount: number;
  readonly winRate: number | null;
  readonly quarters: readonly BacktestDashboardQuarterCell[];
};

export type BacktestDashboardAssetSlice = {
  readonly period: string;
  readonly asset: string;
  readonly quarters: readonly string[];
  readonly rows: readonly BacktestDashboardCandidateRow[];
};

export type BacktestDashboardPeriodSlice = {
  readonly period: string;
  readonly defaultAsset: string;
  readonly supportedAssets: readonly string[];
  readonly byAsset: {
    readonly [asset: string]: BacktestDashboardAssetSlice;
  };
};

export type BacktestDashboardPayload = {
  readonly generatedAtMs: number;
  readonly defaultPeriod: string;
  readonly defaultAsset: string;
  readonly supportedPeriods: readonly string[];
  readonly supportedAssets: readonly string[];
  readonly byPeriod: {
    readonly [period: string]: BacktestDashboardPeriodSlice;
  };
};
