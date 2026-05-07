export type TradingPerformanceSource = {
  readonly positions: string;
};

export type TradingPerformanceSummary = {
  readonly walletAddress: string;
  readonly positionCount: number;
  readonly openPositionCount: number;
  readonly redeemablePositionCount: number;
  readonly winningPositionCount: number;
  readonly losingPositionCount: number;
  readonly flatPositionCount: number;
  readonly lifetimePnlUsd: number;
  readonly totalInvestedUsd: number;
  readonly currentValueUsd: number;
};

export type TradingPerformanceChartPoint = {
  readonly conditionId: string;
  readonly symbol: string;
  readonly title: string;
  readonly orderedAtMs: number;
  readonly positionPnlUsd: number;
  readonly cumulativePnlUsd: number;
};

export type TradingPerformancePositionStatus = "open" | "redeemable";
export type TradingPerformancePositionResult = "win" | "loss" | "flat" | "open";

export type TradingPerformancePositionRow = {
  readonly conditionId: string;
  readonly tokenId: string;
  readonly oppositeTokenId: string | null;
  readonly symbol: string;
  readonly title: string;
  readonly slug: string | null;
  readonly outcome: string;
  readonly size: number;
  readonly avgPrice: number;
  readonly currentPrice: number;
  readonly initialValueUsd: number;
  readonly currentValueUsd: number;
  readonly cashPnlUsd: number;
  readonly realizedPnlUsd: number;
  readonly endDateMs: number | null;
  readonly status: TradingPerformancePositionStatus;
  readonly result: TradingPerformancePositionResult;
};

export type TradingPerformancePayload = {
  readonly command: "trading:performance";
  readonly generatedAtMs: number;
  readonly walletAddress: string;
  readonly source: TradingPerformanceSource;
  readonly summary: TradingPerformanceSummary;
  readonly chart: readonly TradingPerformanceChartPoint[];
  readonly positions: readonly TradingPerformancePositionRow[];
};
