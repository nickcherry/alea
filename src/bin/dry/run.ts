import { assetValues } from "@alea/constants/assets";
import {
  TRADE_DECISION_DEFAULT_PERIODS,
  TRADE_DECISION_SUPPORTED_PERIODS,
} from "@alea/constants/tradeDecision";
import { defineCommand } from "@alea/lib/cli/defineCommand";
import { defineValueOption } from "@alea/lib/cli/defineValueOption";
import { createDatabase } from "@alea/lib/db/createDatabase";
import { destroyDatabase } from "@alea/lib/db/destroyDatabase";
import { runDryRun } from "@alea/lib/dryRun/runDryRun";
import pc from "picocolors";
import { z } from "zod";

const tradeDecisionPeriodSchema = z.enum(TRADE_DECISION_SUPPORTED_PERIODS);

/**
 * Boots the dry-run trader loop. Hydrates per-asset bar history from
 * the `candles` table, refreshes recent Pyth candles one full candle
 * before each target boundary, and runs the committee on closed bars.
 * Decisions land in
 * `dry_run_decisions`; the configured pre-open Polymarket order is
 * simulated; outcomes are scored once the target bar finalizes.
 *
 * Stays running until SIGINT / SIGTERM. Intended to live in a
 * long-running tmux / background session.
 */
export const dryRunCommand = defineCommand({
  name: "dry:run",
  summary: "Run the committee in dry-run mode against live Pyth prices",
  description:
    "Long-running process. Hydrates bar history from `candles`, refreshes recent Pyth candles one full candle before each target boundary, and runs the committee on closed bars to predict the target bar's direction. Predictions land in `dry_run_decisions`; the configured pre-open Polymarket order is simulated; outcomes auto-score when the target bar closes.",
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
  examples: ["bun alea dry:run", "bun alea dry:run --periods 15m"],
  output:
    "Streams decision, simulated-order, and outcome events to stdout. Persists to the `dry_run_decisions` table.",
  sideEffects:
    "Fetches recent Pyth/Coinbase candles and opens Polymarket market-data connections for order simulation. Reads from `candles`, writes to `dry_run_decisions`. Runs until killed.",
  async run({ io, options }) {
    io.writeStdout(
      `${pc.bold("dry:run")} ${pc.dim(`periods=${options.periods.join(",")} assets=${assetValues.join(",")}`)}\n\n`,
    );
    const db = createDatabase();
    let handle: Awaited<ReturnType<typeof runDryRun>> | null = null;
    const stop = async (): Promise<void> => {
      if (handle !== null) {
        await handle.stop();
        handle = null;
      }
      await destroyDatabase(db);
    };
    process.on("SIGINT", () => {
      void stop().then(() => process.exit(0));
    });
    process.on("SIGTERM", () => {
      void stop().then(() => process.exit(0));
    });
    try {
      handle = await runDryRun({
        db,
        assets: [...assetValues],
        periods: options.periods,
        log: (event) => {
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
              const stale =
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
                `${pc.dim(ts)} ${tag} committee roster: ${event.bucketCount} buckets, ${event.totalCandidates} candidates ${pc.dim(`(selected_at=${stale})`)}\n`,
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
              const regime = event.marketRegime ?? "—";
              io.writeStdout(
                `${pc.dim(ts)} ${tag} ${event.period}/${event.asset.padEnd(5)} target=${new Date(event.tsMs).toISOString().slice(11, 16)} ref=${event.referenceClose.toFixed(2)} ${pc.dim("regime=" + regime + " roster=" + event.rosterSize + " u=" + event.up + " d=" + event.down + " a=" + event.abstain)}\n`,
              );
              break;
            }
            case "outcome": {
              const tag = event.won ? pc.green("WIN ") : pc.red("LOSS");
              io.writeStdout(
                `${pc.dim(ts)} ${tag} ${event.period}/${event.asset.padEnd(5)} bar=${new Date(event.tsMs).toISOString().slice(11, 16)} pred=${event.prediction} open=${event.actualOpen.toFixed(2)} close=${event.actualClose.toFixed(2)}\n`,
              );
              break;
            }
            case "order": {
              const tag =
                event.status === "filled"
                  ? pc.green("FILLED")
                  : event.status === "unfilled"
                    ? pc.yellow("UNFILL")
                    : event.status.startsWith("skipped")
                      ? pc.dim("SKIP  ")
                      : pc.dim("ORDER ");
              const parts = [
                `target=${new Date(event.tsMs).toISOString().slice(11, 16)}`,
                `pred=${event.prediction}`,
                `status=${event.status}`,
              ];
              if (event.observedPrice !== null) {
                parts.push(`obs=${formatCents(event.observedPrice)}`);
              }
              if (event.limitPrice !== null) {
                parts.push(`limit=${formatCents(event.limitPrice)}`);
              }
              if (event.confidence !== null) {
                parts.push(`conf=${formatCents(event.confidence)}`);
              }
              if (event.fillPrice !== null) {
                parts.push(`fill=${formatCents(event.fillPrice)}`);
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
      // Keep the event loop alive.
      await new Promise(() => {
        /* never resolves */
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
