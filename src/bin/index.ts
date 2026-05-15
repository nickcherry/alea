#!/usr/bin/env bun
import { candlesChartCommand } from "@alea/bin/candles/chart";
import { candlesFillGapsCommand } from "@alea/bin/candles/fillGaps";
import { candlesSyncCommand } from "@alea/bin/candles/sync";
import { dashboardsBuildCommand } from "@alea/bin/dashboards/build";
import { dataCaptureCommand } from "@alea/bin/data/capture";
import { dataIngestPendingCommand } from "@alea/bin/data/ingestPending";
import { dbMigrateCommand } from "@alea/bin/db/migrate";
import { dryRunCommand } from "@alea/bin/dry/run";
import { latencyCaptureCommand } from "@alea/bin/latency/capture";
import { latencyChartCommand } from "@alea/bin/latency/chart";
import { polymarketAuthCheckCommand } from "@alea/bin/polymarket/authCheck";
import { polymarketPriceSampleCommand } from "@alea/bin/polymarket/priceSample";
import { polymarketResolutionsSyncCommand } from "@alea/bin/polymarket/resolutionsSync";
import { predictChartCommand } from "@alea/bin/predict/chart";
import { reliabilityCaptureCommand } from "@alea/bin/reliability/capture";
import { reliabilityChartCommand } from "@alea/bin/reliability/chart";
import { sayTextCommand } from "@alea/bin/say/text";
import { telegramTestCommand } from "@alea/bin/telegram/test";
import {
  telemetryBookDepthCommand,
  telemetryOrdersCommand,
  telemetryQueryCommand,
  telemetryRejectsCommand,
} from "@alea/bin/telemetry/query";
import { tradingHydrateLifetimePnlCommand } from "@alea/bin/trading/hydrateLifetimePnl";
import { tradingPerformanceCommand } from "@alea/bin/trading/performance";
import { tradingRunCommand } from "@alea/bin/trading/run";
import { createCli } from "@alea/lib/cli/createCli";

const cli = createCli({
  name: "alea",
  summary: "Polymarket crypto up/down OpenAI chart trader",
  commands: [
    dbMigrateCommand,
    candlesSyncCommand,
    candlesFillGapsCommand,
    candlesChartCommand,
    dryRunCommand,
    dashboardsBuildCommand,
    dataCaptureCommand,
    dataIngestPendingCommand,
    latencyCaptureCommand,
    latencyChartCommand,
    reliabilityCaptureCommand,
    reliabilityChartCommand,
    sayTextCommand,
    telegramTestCommand,
    telemetryQueryCommand,
    telemetryRejectsCommand,
    telemetryBookDepthCommand,
    telemetryOrdersCommand,
    polymarketAuthCheckCommand,
    polymarketPriceSampleCommand,
    polymarketResolutionsSyncCommand,
    predictChartCommand,
    tradingRunCommand,
    tradingHydrateLifetimePnlCommand,
    tradingPerformanceCommand,
  ],
});

await cli.runWithErrorBoundary(process.argv.slice(2));
