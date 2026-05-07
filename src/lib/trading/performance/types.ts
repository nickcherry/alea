export type TradingPerformanceSource = {
  readonly activity: string;
  readonly positions: string;
};

export type TradingPerformanceSummary = {
  readonly walletAddress: string;
  readonly marketCount: number;
  readonly openPositionCount: number;
  readonly redeemablePositionCount: number;
  readonly winningMarketCount: number;
  readonly losingMarketCount: number;
  readonly flatMarketCount: number;
  readonly lifetimePnlUsd: number;
  readonly totalInvestedUsd: number;
  readonly totalReturnedUsd: number;
  readonly currentValueUsd: number;
  readonly makerRebateUsd: number;
};

export type TradingPerformanceChartPoint = {
  readonly conditionId: string;
  readonly symbol: string;
  readonly title: string;
  readonly orderedAtMs: number;
  readonly marketPnlUsd: number;
  readonly cumulativePnlUsd: number;
};

export type TradingPerformanceMarketStatus = "open" | "redeemable" | "closed";
export type TradingPerformanceMarketResult = "win" | "loss" | "flat" | "open";
/**
 * Trader role on a given market, summarised across every CLOB fill.
 * `null` when /trades returned no fills for the market — typically
 * because /trades has truncated the older end of the wallet's history.
 */
export type TradingPerformanceMarketRole = "maker" | "taker" | "mixed" | null;

export type TradingPerformanceMarketRow = {
  readonly conditionId: string;
  readonly symbol: string;
  readonly title: string;
  readonly slug: string | null;
  readonly outcome: string | null;
  readonly endDateMs: number | null;
  readonly lastActivityAtMs: number;
  readonly investedUsd: number;
  readonly returnedUsd: number;
  readonly currentValueUsd: number;
  readonly currentSize: number;
  readonly currentPrice: number;
  readonly pnlUsd: number;
  readonly status: TradingPerformanceMarketStatus;
  readonly result: TradingPerformanceMarketResult;
  /** Predominant fill role across this market's CLOB trades. */
  readonly traderRole: TradingPerformanceMarketRole;
  /** Total CLOB fees paid on this market across all fills. */
  readonly feeUsd: number | null;
};

export type TradingPerformancePayload = {
  readonly command: "trading:performance";
  readonly generatedAtMs: number;
  readonly walletAddress: string;
  readonly source: TradingPerformanceSource;
  readonly summary: TradingPerformanceSummary;
  readonly chart: readonly TradingPerformanceChartPoint[];
  readonly markets: readonly TradingPerformanceMarketRow[];
};
