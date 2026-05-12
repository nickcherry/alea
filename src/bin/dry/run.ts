import { assetValues } from "@alea/constants/assets";
import { defineCommand } from "@alea/lib/cli/defineCommand";
import { createDatabase } from "@alea/lib/db/createDatabase";
import { destroyDatabase } from "@alea/lib/db/destroyDatabase";
import { runDryRun } from "@alea/lib/dryRun/runDryRun";
import pc from "picocolors";

/**
 * Boots the dry-run trader loop. Hydrates per-asset bar history from
 * the `candles` table, subscribes to Pyth Hermes ticks for every
 * registered asset, and runs the committee on every 5m boundary
 * (snapshotting the Pyth price 5 seconds before the boundary as the
 * synthetic close of the about-to-finalize bar). Decisions land in
 * `dry_run_decisions`; the configured post-open Polymarket order is
 * simulated; outcomes are scored once the target bar finalizes.
 *
 * Stays running until SIGINT / SIGTERM. Intended to live in a
 * long-running tmux / background session.
 */
export const dryRunCommand = defineCommand({
  name: "dry:run",
  summary: "Run the committee in dry-run mode against live Pyth prices",
  description:
    "Long-running process. Hydrates bar history from `candles`, subscribes to Pyth Hermes for live ticks, and at T-5s of each 5m boundary runs the committee to predict the next 5m bar's direction. Predictions land in `dry_run_decisions`; the configured post-open Polymarket order is simulated; outcomes auto-score when the target bar closes.",
  options: [],
  examples: ["bun alea dry:run"],
  output:
    "Streams decision, simulated-order, and outcome events to stdout. Persists to the `dry_run_decisions` table.",
  sideEffects:
    "Opens Pyth Hermes and Polymarket market-data connections. Reads from `candles`, writes to `dry_run_decisions`. Runs until killed.",
  async run({ io }) {
    io.writeStdout(`${pc.bold("dry:run")} ${pc.dim(`assets=${assetValues.join(",")}`)}\n\n`);
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
        log: (event) => {
          const ts = new Date().toISOString().slice(11, 19);
          switch (event.kind) {
            case "hydrated":
              io.writeStdout(
                `${pc.dim(ts)} ${pc.green("hydrated")} ${event.asset} ${pc.dim("bars=" + event.barCount)}\n`,
              );
              break;
            case "connected":
              io.writeStdout(`${pc.dim(ts)} ${pc.green("connected")}\n`);
              break;
            case "disconnected":
              io.writeStdout(`${pc.dim(ts)} ${pc.yellow("disconnected")} ${pc.dim(event.reason)}\n`);
              break;
            case "roster": {
              const stale =
                event.selectedAtMs === null
                  ? "unknown"
                  : new Date(event.selectedAtMs).toISOString().slice(0, 16).replace("T", " ");
              const tag =
                event.totalCandidates === 0 ? pc.red("EMPTY") : pc.green("loaded");
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
                `${pc.dim(ts)} ${tag} ${event.asset.padEnd(5)} target=${new Date(event.tsMs).toISOString().slice(11, 16)} synth=${event.synthClose.toFixed(2)} ${pc.dim("regime=" + regime + " roster=" + event.rosterSize + " u=" + event.up + " d=" + event.down + " a=" + event.abstain)}\n`,
              );
              break;
            }
            case "outcome": {
              const tag = event.won ? pc.green("WIN ") : pc.red("LOSS");
              io.writeStdout(
                `${pc.dim(ts)} ${tag} ${event.asset.padEnd(5)} bar=${new Date(event.tsMs).toISOString().slice(11, 16)} pred=${event.prediction} open=${event.actualOpen.toFixed(2)} close=${event.actualClose.toFixed(2)}\n`,
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
                `${pc.dim(ts)} ${tag} ${event.asset.padEnd(5)} ${pc.dim(parts.join(" "))}\n`,
              );
              break;
            }
            case "error":
              io.writeStdout(`${pc.dim(ts)} ${pc.red("error")} ${event.message}\n`);
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
