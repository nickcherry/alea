#!/usr/bin/env bun
import { backtestRunCommand } from "@alea/bin/backtest/run";
import { candlesChartCommand } from "@alea/bin/candles/chart";
import { candlesFillGapsCommand } from "@alea/bin/candles/fillGaps";
import { candlesSyncCommand } from "@alea/bin/candles/sync";
import { dashboardsBuildCommand } from "@alea/bin/dashboards/build";
import { dataCaptureCommand } from "@alea/bin/data/capture";
import { dataIngestPendingCommand } from "@alea/bin/data/ingestPending";
import { dbMigrateCommand } from "@alea/bin/db/migrate";
import { dryRunCommand } from "@alea/bin/dry/run";
import { filtersVisualizeCommand } from "@alea/bin/filters/visualize";
import { latencyCaptureCommand } from "@alea/bin/latency/capture";
import { latencyChartCommand } from "@alea/bin/latency/chart";
import { polymarketAuthCheckCommand } from "@alea/bin/polymarket/authCheck";
import { polymarketPriceSampleCommand } from "@alea/bin/polymarket/priceSample";
import { polymarketResolutionsSyncCommand } from "@alea/bin/polymarket/resolutionsSync";
import { reliabilityCaptureCommand } from "@alea/bin/reliability/capture";
import { reliabilityChartCommand } from "@alea/bin/reliability/chart";
import { researchCompressionBreakoutSweepCommand } from "@alea/bin/research/compressionBreakoutSweep";
import { researchExhaustionReversalSweepCommand } from "@alea/bin/research/exhaustionReversalSweep";
import { researchFailedBreakoutReversalSweepCommand } from "@alea/bin/research/failedBreakoutReversalSweep";
import { researchMaRejectionSweepCommand } from "@alea/bin/research/maRejectionSweep";
import { researchRsiDivergenceSweepCommand } from "@alea/bin/research/rsiDivergenceSweep";
import { researchTrendPullbackResumeSweepCommand } from "@alea/bin/research/trendPullbackResumeSweep";
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
  summary: "Polymarket crypto up/down filter trader",
  commands: [
    backtestRunCommand,
    dbMigrateCommand,
    candlesSyncCommand,
    candlesFillGapsCommand,
    candlesChartCommand,
    dryRunCommand,
    filtersVisualizeCommand,
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
    researchCompressionBreakoutSweepCommand,
    researchExhaustionReversalSweepCommand,
    researchFailedBreakoutReversalSweepCommand,
    researchMaRejectionSweepCommand,
    researchRsiDivergenceSweepCommand,
    researchTrendPullbackResumeSweepCommand,
    tradingRunCommand,
    tradingHydrateLifetimePnlCommand,
    tradingPerformanceCommand,
  ],
});

await cli.runWithErrorBoundary(process.argv.slice(2));
