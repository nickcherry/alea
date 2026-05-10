#!/usr/bin/env bun
import { candlesFillGapsCommand } from "@alea/bin/candles/fillGaps";
import { candlesSyncCommand } from "@alea/bin/candles/sync";
import { dashboardsBuildCommand } from "@alea/bin/dashboards/build";
import { dataCaptureCommand } from "@alea/bin/data/capture";
import { dataIngestPendingCommand } from "@alea/bin/data/ingestPending";
import { dbMigrateCommand } from "@alea/bin/db/migrate";
import { latencyCaptureCommand } from "@alea/bin/latency/capture";
import { latencyChartCommand } from "@alea/bin/latency/chart";
import { polymarketAuthCheckCommand } from "@alea/bin/polymarket/authCheck";
import { reliabilityCaptureCommand } from "@alea/bin/reliability/capture";
import { reliabilityChartCommand } from "@alea/bin/reliability/chart";
import { telegramTestCommand } from "@alea/bin/telegram/test";
import { tradingHydrateLifetimePnlCommand } from "@alea/bin/trading/hydrateLifetimePnl";
import { tradingPerformanceCommand } from "@alea/bin/trading/performance";
import { createCli } from "@alea/lib/cli/createCli";

const cli = createCli({
  name: "alea",
  summary: "Polymarket crypto up/down filter-committee trader",
  commands: [
    dbMigrateCommand,
    candlesSyncCommand,
    candlesFillGapsCommand,
    dashboardsBuildCommand,
    dataCaptureCommand,
    dataIngestPendingCommand,
    latencyCaptureCommand,
    latencyChartCommand,
    reliabilityCaptureCommand,
    reliabilityChartCommand,
    telegramTestCommand,
    polymarketAuthCheckCommand,
    tradingHydrateLifetimePnlCommand,
    tradingPerformanceCommand,
  ],
});

await cli.runWithErrorBoundary(process.argv.slice(2));
