import type { BacktestDashboardPayload } from "@alea/lib/backtest/dashboard/types";
import type { CommitteeBacktestSummary } from "@alea/lib/backtest/runCommitteeBacktest";
import type { DatabaseClient } from "@alea/lib/db/types";

export async function loadBacktestPayload({
  db,
  now = () => Date.now(),
}: {
  readonly db: DatabaseClient;
  readonly now?: () => number;
}): Promise<BacktestDashboardPayload> {
  const row = await db
    .selectFrom("committee_backtest_runs")
    .select(["id", "summary_json"])
    .orderBy("completed_at_ms", "desc")
    .limit(1)
    .executeTakeFirst();

  return {
    generatedAtMs: now(),
    latestRun:
      row === undefined
        ? null
        : {
            ...(row.summary_json as CommitteeBacktestSummary),
            id: String(row.id),
          },
  };
}
