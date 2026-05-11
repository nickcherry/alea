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
  /**
   * Static count of every (filter, config) candidate registered in
   * the committee at the time the dashboard was built. Reflects the
   * pool the committee draws from — abstaining candidates are still
   * counted.
   */
  readonly candidateCount: number;
  /**
   * Average number of candidates that voted (up or down — abstains
   * excluded) per non-abstaining decision. Lower = the committee is
   * acting on slim engagement; higher = broad consensus.
   */
  readonly avgEngagement: number | null;
};

export type DryRunDashboardAssetRow = {
  readonly asset: string;
  readonly settled: number;
  readonly pending: number;
  readonly wins: number;
  readonly winRate: number | null;
};

export type DryRunDashboardRecentRow = {
  readonly id: string;
  readonly tsMs: number;
  readonly decidedAtMs: number;
  readonly asset: string;
  readonly prediction: "u" | "d";
  readonly synthOpen: number;
  readonly actualClose: number | null;
  readonly won: number | null;
  readonly marketRegime: string | null;
};

export type DryRunDashboardRegimeAggregate = {
  /** Market regime name, e.g. "low_vol_trending". `null` when the
   * classifier couldn't decide (pre-classifier rows or very short
   * bar buffers). */
  readonly marketRegime: string | null;
  readonly calls: number;
  readonly wins: number;
  readonly winRate: number | null;
};

export type DryRunDashboardCumulativeRow = {
  readonly tsMs: number;
  readonly settled: number;
  readonly wins: number;
  readonly cumWinRate: number;
};

export type DryRunDashboardPayload = {
  readonly generatedAtMs: number;
  readonly summary: DryRunDashboardSummary;
  readonly perAsset: readonly DryRunDashboardAssetRow[];
  readonly perRegime: readonly DryRunDashboardRegimeAggregate[];
  readonly recent: readonly DryRunDashboardRecentRow[];
  readonly cumulative: readonly DryRunDashboardCumulativeRow[];
};
