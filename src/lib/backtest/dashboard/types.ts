import type { CommitteeBacktestSummary } from "@alea/lib/backtest/runCommitteeBacktest";

export type BacktestDashboardPayload = {
  readonly generatedAtMs: number;
  readonly latestRun: null | (CommitteeBacktestSummary & {
    readonly id: string;
  });
};
