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
import { tradingCalibrateEvRrGateCommand } from "@alea/bin/trading/calibrateEvRrGate";
import { tradingDryRunCommand } from "@alea/bin/trading/dryRun";
import { tradingDryRunReportCommand } from "@alea/bin/trading/dryRunReport";
import { tradingGenProbabilityTableCommand } from "@alea/bin/trading/genProbabilityTable";
import { tradingHydrateLifetimePnlCommand } from "@alea/bin/trading/hydrateLifetimePnl";
import { tradingLiveCommand } from "@alea/bin/trading/live";
import { tradingPerformanceCommand } from "@alea/bin/trading/performance";
import { tradingReplayCommand } from "@alea/bin/trading/replay";
import { tradingReplayReportCommand } from "@alea/bin/trading/replayReport";
import { trainingDistributionsCommand } from "@alea/bin/training/distributions";
import { createCli } from "@alea/lib/cli/createCli";

const cli = createCli({
  name: "alea",
  summary: "Polymarket crypto up/down monitor and gated trader",
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
    trainingDistributionsCommand,
    telegramTestCommand,
    polymarketAuthCheckCommand,
    tradingGenProbabilityTableCommand,
    tradingDryRunCommand,
    tradingDryRunReportCommand,
    tradingLiveCommand,
    tradingHydrateLifetimePnlCommand,
    tradingPerformanceCommand,
    tradingReplayCommand,
    tradingReplayReportCommand,
    tradingCalibrateEvRrGateCommand,
  ],
});

await cli.runWithErrorBoundary(process.argv.slice(2));
