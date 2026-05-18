#!/usr/bin/env bun
import { backtestRunCommand } from "@alea/bin/backtest/run";
import { candlesFillGapsCommand } from "@alea/bin/candles/fillGaps";
import { candlesSyncCommand } from "@alea/bin/candles/sync";
import { dashboardsBuildCommand } from "@alea/bin/dashboards/build";
import { dbMigrateCommand } from "@alea/bin/db/migrate";
import { createCli } from "@alea/lib/cli/createCli";

const cli = createCli({
  name: "alea",
  summary: "Crypto candle backtesting harness",
  commands: [
    backtestRunCommand,
    dbMigrateCommand,
    candlesSyncCommand,
    candlesFillGapsCommand,
    dashboardsBuildCommand,
  ],
});

await cli.runWithErrorBoundary(process.argv.slice(2));
