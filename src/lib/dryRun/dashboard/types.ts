export type DryRunDashboardSummary = {
  readonly totalDecisions: number;
  readonly settledDecisions: number;
  readonly pendingDecisions: number;
  readonly totalWins: number;
  readonly winRate: number | null;
  readonly upDecisions: number;
  readonly downDecisions: number;
  readonly upWins: number;
  readonly downWins: number;
  readonly firstDecisionAtMs: number | null;
  readonly lastDecisionAtMs: number | null;
};

export type DryRunDecisionConfig = {
  readonly period: string;
  /**
   * Every candle period the dry-run table can hold a decision for.
   * Drives the page-level period toggle so the UI shows the same set
   * of options the schema allows, not whatever happens to have rows.
   */
  readonly supportedPeriods: readonly string[];
  readonly leadTimeByPeriodMs: { readonly [period: string]: number };
  readonly decisionSource: string;
  readonly hydratedBarsByPeriod: { readonly [period: string]: number };
  readonly orderPlacementDelayMs: number;
  readonly orderLimitPricePolicy: string;
  readonly orderPriceWindowCents: number;
  readonly orderMaxQuoteAgeMs: number;
  readonly marketDiscoveryLeadMs: number;
};

export type DryRunDashboardAssetRow = {
  readonly asset: string;
  readonly settled: number;
  readonly pending: number;
  readonly wins: number;
  readonly winRate: number | null;
  /** Settled decisions where the predictor called UP. */
  readonly upSettled: number;
  /** Settled decisions where the predictor called DOWN. */
  readonly downSettled: number;
};

export type DryRunDashboardRecentRow = {
  readonly id: string;
  readonly tsMs: number;
  readonly decidedAtMs: number;
  readonly asset: string;
  readonly period: string;
  readonly prediction: "u" | "d";
  readonly synthOpen: number;
  readonly actualOpen: number | null;
  readonly actualClose: number | null;
  readonly won: number | null;
  readonly orderStatus: string;
  readonly orderObservedPrice: number | null;
  readonly orderLimitPrice: number | null;
  readonly orderConfidence: number | null;
  readonly orderFillPrice: number | null;
  readonly decisionDurationMs: number | null;
  readonly orderFillLatencyMs: number | null;
};

export type DryRunDashboardCumulativeRow = {
  readonly tsMs: number;
  readonly settled: number;
  readonly wins: number;
  readonly cumWinRate: number;
};

/**
 * Aggregates split out per candle period. The client renders one slice
 * at a time as the user flips the 5m/15m toggle; the SSR pass shows the
 * `decisionConfig.period` slice (the default display period).
 */
export type DryRunDashboardPeriodSlice = {
  readonly summary: DryRunDashboardSummary;
  readonly perAsset: readonly DryRunDashboardAssetRow[];
  readonly cumulative: readonly DryRunDashboardCumulativeRow[];
};

export type DryRunDashboardPayload = {
  readonly generatedAtMs: number;
  readonly decisionConfig: DryRunDecisionConfig;
  /**
   * One entry per supported candle period. Always populated for every
   * period in `decisionConfig.supportedPeriods`, even if there are no
   * decisions yet — empty slices render as "no data" panels.
   */
  readonly byPeriod: { readonly [period: string]: DryRunDashboardPeriodSlice };
  /**
   * Newest-first list of decisions across every period. The
   * page renders this client-side filtered by the active period tab.
   */
  readonly recent: readonly DryRunDashboardRecentRow[];
};
