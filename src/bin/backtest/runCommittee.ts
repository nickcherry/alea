import { COMMITTEE_BACKTEST_PROFILE_ID } from "@alea/constants/backtest";
import { runAndPersistCommitteeBacktest } from "@alea/lib/backtest/runCommitteeBacktest";
import { defineCommand } from "@alea/lib/cli/defineCommand";
import { createDatabase } from "@alea/lib/db/createDatabase";
import { destroyDatabase } from "@alea/lib/db/destroyDatabase";
import pc from "picocolors";

export const backtestRunCommand = defineCommand({
  name: "backtest:run",
  summary: "Replay the selected trade committee over the holdout window",
  description:
    "Simulates historical trade committee decisions over the configured post-training holdout window using Pyth spot candles only. It does not connect to Polymarket and does not model order-book fills. Results are persisted to committee_backtest_runs, and the /backtest/ dashboard displays the latest run.",
  options: [],
  examples: ["bun alea backtest:run"],
  output:
    "Prints the replay window, trade count, win rate, PnL proxy, and persisted run id.",
  sideEffects:
    "Reads candles and committee_selections. Inserts one row into committee_backtest_runs. No network.",
  async run({ io }) {
    io.writeStdout(
      `${pc.bold("backtest:run")} ${pc.dim(COMMITTEE_BACKTEST_PROFILE_ID)}\n\n`,
    );
    const db = createDatabase();
    try {
      const result = await runAndPersistCommitteeBacktest({ db });
      const wr =
        result.totals.winRate === null
          ? "-"
          : `${(result.totals.winRate * 100).toFixed(2)}%`;
      io.writeStdout(
        `${pc.dim("window:")} ${new Date(result.windowStartMs).toISOString()} -> ${new Date(
          result.windowEndExclusiveMs,
        ).toISOString()} exclusive\n`,
      );
      io.writeStdout(
        `${pc.green("persisted")} run=${result.id} ` +
          `${pc.dim("duration=")}${result.durationMs.toLocaleString()}ms ` +
          `${pc.dim("decisions=")}${result.totals.committeeDecisions.toLocaleString()} ` +
          `${pc.dim("scored=")}${result.totals.scoredTrades.toLocaleString()} ` +
          `${pc.dim("wr=")}${wr} ` +
          `${pc.dim("pnl=")}$${result.totals.pnlUsd.toLocaleString()}\n`,
      );
    } finally {
      await destroyDatabase(db);
    }
  },
});
