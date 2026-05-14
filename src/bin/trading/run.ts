import { assetValues } from "@alea/constants/assets";
import { env } from "@alea/constants/env";
import {
  TRADE_DECISION_DEFAULT_PERIODS,
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
import pc from "picocolors";
import { z } from "zod";

const tradeDecisionPeriodSchema = z.enum(TRADE_DECISION_SUPPORTED_PERIODS);

export const tradingRunCommand = defineCommand({
  name: "trading:run",
  summary: "Run live committee trading with real Polymarket orders",
  description:
    "Long-running live trader. Hydrates Pyth bar history, pre-discovers and pre-subscribes next Polymarket markets, makes committee decisions before each market opens (5m at T-2m, 15m at T-3m), and starts real post-only maker GTD order placement immediately after each actionable pre-open decision. Reads POLYMARKET_PRIVATE_KEY and POLYMARKET_FUNDER_ADDRESS from the environment.",
  options: [
    defineValueOption({
      key: "periods",
      long: "--periods",
      valueName: "LIST",
      schema: z
        .string()
        .optional()
        .transform((v) =>
          v === undefined ? undefined : v.split(",").map((s) => s.trim()),
        )
        .pipe(
          z
            .array(tradeDecisionPeriodSchema)
            .min(1)
            .default([...TRADE_DECISION_DEFAULT_PERIODS]),
        )
        .describe(
          `Comma-separated trade periods (default: ${TRADE_DECISION_DEFAULT_PERIODS.join(",")}).`,
        ),
    }),
  ],
  examples: ["bun alea trading:run", "bun alea trading:run --periods 5m"],
  output:
    "Streams market subscription, decision, and live-order placement events to stdout. Live order/fill state remains in Polymarket, not the local DB.",
  sideEffects:
    "Places real Polymarket post-only maker orders. Reads committee/candle data from the DB and uses authenticated Polymarket CLOB APIs. Runs until killed.",
  async run({ io, options }) {
    io.writeStdout(
      `${pc.bold("trading:run")} ${pc.dim(`periods=${options.periods.join(",")} assets=${assetValues.join(",")}`)}\n\n`,
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
        assets: [...assetValues],
        periods: options.periods,
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
            case "roster": {
              const selectedAt =
                event.selectedAtMs === null
                  ? "unknown"
                  : new Date(event.selectedAtMs)
                      .toISOString()
                      .slice(0, 16)
                      .replace("T", " ");
              const tag =
                event.totalCandidates === 0
                  ? pc.red("EMPTY")
                  : pc.green("loaded");
              io.writeStdout(
                `${pc.dim(ts)} ${tag} committee roster: ${event.bucketCount} buckets, ${event.totalCandidates} candidates ${pc.dim(`(selected_at=${selectedAt})`)}\n`,
              );
              break;
            }
            case "decision": {
              const tag =
                event.prediction === null
                  ? pc.dim("abstain")
                  : event.prediction === "u"
                    ? pc.green("UP    ")
                    : pc.red("DOWN  ");
              const regime = event.marketRegime ?? "-";
              const confidence =
                event.confidence === null
                  ? "-"
                  : `${(event.confidence * 100).toFixed(1)}c`;
              const priceAge =
                event.priceAgeMs === null
                  ? ""
                  : ` priceAge=${event.priceAgeMs}ms`;
              io.writeStdout(
                `${pc.dim(ts)} ${tag} ${event.period}/${event.asset.padEnd(5)} target=${new Date(event.tsMs).toISOString().slice(11, 16)} synth=${event.synthClose.toFixed(2)} ${pc.dim("regime=" + regime + " roster=" + event.rosterSize + " u=" + event.up + " d=" + event.down + " a=" + event.abstain + " conf=" + confidence + priceAge)}\n`,
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
                parts.push(`conf=${formatCents(event.confidence)}`);
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
