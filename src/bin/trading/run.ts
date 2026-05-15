import { env } from "@alea/constants/env";
import {
  formatTradeDecisionMarkets,
  resolveTradeDecisionMarkets,
  TRADE_DECISION_DEFAULT_ASSETS,
  TRADE_DECISION_DEFAULT_MARKETS,
  TRADE_DECISION_SUPPORTED_PERIODS,
} from "@alea/constants/tradeDecision";
import { defineCommand } from "@alea/lib/cli/defineCommand";
import { defineValueOption } from "@alea/lib/cli/defineValueOption";
import { createDatabase } from "@alea/lib/db/createDatabase";
import { destroyDatabase } from "@alea/lib/db/destroyDatabase";
import {
  createAxiomTelemetrySink,
  createTelemetryRunId,
  defaultTelemetryFields,
  detectGitSha,
} from "@alea/lib/telemetry/axiom";
import { liveTradingLogEventToTelemetry } from "@alea/lib/telemetry/liveTrading";
import { runLiveTrading } from "@alea/lib/trading/runLiveTrading";
import { assetSchema } from "@alea/types/assets";
import pc from "picocolors";
import { z } from "zod";

const tradeDecisionPeriodSchema = z.enum(TRADE_DECISION_SUPPORTED_PERIODS);
const commaSeparatedPeriodsSchema = z
  .string()
  .optional()
  .transform((v) =>
    v === undefined ? undefined : v.split(",").map((s) => s.trim()),
  )
  .pipe(z.array(tradeDecisionPeriodSchema).min(1).optional());
const commaSeparatedAssetsSchema = z
  .string()
  .optional()
  .transform((v) =>
    v === undefined ? undefined : v.split(",").map((s) => s.trim()),
  )
  .pipe(z.array(assetSchema).min(1).optional());

export const tradingRunCommand = defineCommand({
  name: "trading:run",
  summary: "Run live OpenAI chart trading with real Polymarket orders",
  description:
    "Long-running live trader. Hydrates Pyth bar history, pre-discovers and pre-subscribes next Polymarket markets, renders charts, asks OpenAI for pre-open next-candle predictions (5m at T-2m, 15m at T-3m), and starts real post-only maker GTD order placement immediately after each returned green/red prediction. Reads POLYMARKET_PRIVATE_KEY, POLYMARKET_FUNDER_ADDRESS, and OPENAI_API_KEY from the environment.",
  options: [
    defineValueOption({
      key: "periods",
      long: "--periods",
      valueName: "LIST",
      schema: commaSeparatedPeriodsSchema.describe(
        `Comma-separated trade periods. With no asset/period override, defaults to ${formatTradeDecisionMarkets({ markets: TRADE_DECISION_DEFAULT_MARKETS })}.`,
      ),
    }),
    defineValueOption({
      key: "assets",
      long: "--assets",
      valueName: "LIST",
      schema: commaSeparatedAssetsSchema.describe(
        `Comma-separated assets. With --periods only, defaults to ${TRADE_DECISION_DEFAULT_ASSETS.join(",")}.`,
      ),
    }),
  ],
  examples: [
    "bun alea trading:run",
    "bun alea trading:run --periods 15m",
    "bun alea trading:run --assets eth --periods 5m,15m",
  ],
  output:
    "Streams market subscription, decision, and live-order placement events to stdout. Live order/fill state remains in Polymarket, not the local DB.",
  sideEffects:
    "Places real Polymarket post-only maker orders. Reads candle data from the DB, renders chart images, calls the OpenAI Responses API, and uses authenticated Polymarket CLOB APIs. Runs until killed.",
  async run({ io, options }) {
    suppressVerboseClobClientRequestLogs();
    const markets = resolveTradeDecisionMarkets({
      assets: options.assets,
      periods: options.periods,
    });
    if (env.openaiApiKey === undefined) {
      throw new Error("OPENAI_API_KEY is required for live trading decisions.");
    }
    io.writeStdout(
      `${pc.bold("trading:run")} ${pc.dim(`markets=${formatTradeDecisionMarkets({ markets })}`)}\n\n`,
    );
    const runId = createTelemetryRunId();
    const telemetry = createAxiomTelemetrySink({
      apiKey: env.axiomApiKey,
      dataset: env.axiomDataset,
      domain: env.axiomDomain,
      defaultFields: defaultTelemetryFields({
        runId,
        gitSha: detectGitSha(),
      }),
    });
    io.writeStdout(
      `${pc.dim("telemetry:")} ${telemetry.enabled ? pc.green("axiom enabled") : pc.yellow("axiom disabled")} dataset=${telemetry.dataset} spool=${telemetry.spoolPath}\n\n`,
    );
    const db = createDatabase();
    let handle: Awaited<ReturnType<typeof runLiveTrading>> | null = null;
    let stopped = false;
    const stop = async (): Promise<void> => {
      if (stopped) {
        return;
      }
      stopped = true;
      if (handle !== null) {
        await handle.stop();
        handle = null;
      }
      await telemetry.close();
      await destroyDatabase(db);
    };
    process.on("SIGINT", () => {
      void stop().then(() => process.exit(0));
    });
    process.on("SIGTERM", () => {
      void stop().then(() => process.exit(0));
    });
    try {
      handle = await runLiveTrading({
        db,
        markets,
        log: (event) => {
          try {
            telemetry.emit(liveTradingLogEventToTelemetry(event));
          } catch {
            // Telemetry must never interfere with live trading.
          }
          const ts = new Date().toISOString().slice(11, 19);
          switch (event.kind) {
            case "hydrated":
              io.writeStdout(
                `${pc.dim(ts)} ${pc.green("hydrated")} ${event.period}/${event.asset} ${pc.dim("bars=" + event.barCount)}\n`,
              );
              break;
            case "ready":
              io.writeStdout(`${pc.dim(ts)} ${pc.green("ready")}\n`);
              break;
            case "predictor":
              io.writeStdout(
                `${pc.dim(ts)} ${pc.green("predictor")} ${event.source}\n`,
              );
              break;
            case "decision": {
              const tag =
                event.prediction === "u"
                  ? pc.green("UP    ")
                  : pc.red("DOWN  ");
              const priceAge =
                event.priceAgeMs === null
                  ? ""
                  : ` priceAge=${event.priceAgeMs}ms`;
              const reason =
                event.reasoning === null ? "" : ` reason=${event.reasoning}`;
              io.writeStdout(
                `${pc.dim(ts)} ${tag} ${event.period}/${event.asset.padEnd(5)} target=${new Date(event.tsMs).toISOString().slice(11, 16)} synth=${event.synthClose.toFixed(2)} ${pc.dim("source=openai model=" + (event.model ?? "-") + priceAge + reason)}\n`,
              );
              break;
            }
            case "live-market": {
              if (event.status === "subscribed") {
                io.writeStdout(
                  `${pc.dim(ts)} ${pc.green("market")} subscribed ${event.marketCount} market(s)\n`,
                );
                break;
              }
              const color =
                event.status === "stream-connected" ? pc.green : pc.yellow;
              io.writeStdout(
                `${pc.dim(ts)} ${color(event.status)}${event.message === null ? "" : " " + pc.dim(event.message)}\n`,
              );
              break;
            }
            case "live-order": {
              if (event.status === "attempting") {
                break;
              }
              const tag =
                event.status === "placed"
                  ? pc.green("PLACED")
                  : event.status === "scheduled"
                    ? pc.dim("SCHED ")
                    : pc.yellow("SKIP  ");
              const parts = [
                `target=${new Date(event.tsMs).toISOString().slice(11, 16)}`,
                `pred=${event.prediction}`,
                `status=${event.status}`,
              ];
              if (event.attempt !== null) {
                parts.push(`attempt=${event.attempt}`);
              }
              if (event.limitPrice !== null) {
                parts.push(`limit=${formatCents(event.limitPrice)}`);
              }
              if (event.confidence !== null) {
                parts.push(`conf=${formatConfidence(event.confidence)}`);
              }
              if (event.orderId !== null) {
                parts.push(`order=${event.orderId.slice(0, 10)}...`);
              }
              if (event.message !== null && event.status !== "placed") {
                parts.push(event.message);
              }
              io.writeStdout(
                `${pc.dim(ts)} ${tag} ${event.period}/${event.asset.padEnd(5)} ${pc.dim(parts.join(" "))}\n`,
              );
              break;
            }
            case "error":
              io.writeStdout(
                `${pc.dim(ts)} ${pc.red("error")} ${event.message}\n`,
              );
              break;
          }
        },
      });
      await new Promise(() => {
        /* live process */
      });
    } catch (e) {
      io.writeStdout(`${pc.red("fatal:")} ${String(e)}\n`);
      await stop();
      throw e;
    }
  },
});

function formatCents(value: number): string {
  return `${(value * 100).toFixed(1)}c`;
}

function formatConfidence(value: number): string {
  return value.toFixed(2);
}

let clobClientRequestLogSuppressed = false;

function suppressVerboseClobClientRequestLogs(): void {
  if (clobClientRequestLogSuppressed) {
    return;
  }
  clobClientRequestLogSuppressed = true;
  // The SDK dumps signed request headers on post failures; our own order log
  // already records the sanitized failure path.
  const originalError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    const first = args[0];
    if (
      typeof first === "string" &&
      first.startsWith("[CLOB Client] request error")
    ) {
      return;
    }
    originalError(...args);
  };
}
