import { assetValues } from "@alea/constants/assets";
import { defineCommand } from "@alea/lib/cli/defineCommand";
import { defineValueOption } from "@alea/lib/cli/defineValueOption";
import { createDatabase } from "@alea/lib/db/createDatabase";
import { destroyDatabase } from "@alea/lib/db/destroyDatabase";
import {
  syncPolymarketResolutions,
  type SyncResolutionsResult,
} from "@alea/lib/polymarket/syncResolutions";
import { assetSchema } from "@alea/types/assets";
import { resolutionTimeframeSchema } from "@alea/types/resolutions";
import pc from "picocolors";
import { z } from "zod";

const millisecondsPerDay = 86_400_000;

/** Default 1h resolution backfill window. */
const defaultDays = 200;

/**
 * Per-task gamma-api concurrency. Probing shows the endpoint handles 10+
 * parallel requests cleanly with ~50 ms per response after the first; 8
 * gives a comfortable margin against transient rate-limit headers without
 * leaving wall time on the table.
 */
const perTaskConcurrency = 8;

/**
 * Cross-task fan-out. The slow part is the network round trip, not CPU,
 * so two tasks running their inner workers gives an aggregate concurrency
 * around 16 — still well within the gamma-api's tolerance and far enough
 * below the network's saturation point to keep latency stable.
 */
const taskParallelism = 2;
const defaultTimeframes = ["1h"] as const;

export const polymarketResolutionsSyncCommand = defineCommand({
  name: "polymarket:resolutions-sync",
  summary: "Backfill Polymarket up/down resolutions into Postgres",
  description:
    "Walks the historical window grid for each (asset, timeframe) and stores Polymarket's settled outcome (up / down / void) into the polymarket_resolutions table. Windows already stored are skipped, and pending / disputed markets are left for a later pass. Pair with the existing Pyth candles to compute proxy-accuracy stats on the / proxy / dashboard.",
  options: [
    defineValueOption({
      key: "days",
      long: "--days",
      valueName: "N",
      schema: z.coerce
        .number()
        .int()
        .positive()
        .default(defaultDays)
        .describe("Lookback window in days."),
    }),
    defineValueOption({
      key: "assets",
      long: "--assets",
      valueName: "LIST",
      schema: z
        .string()
        .optional()
        .transform((value) => parseList(value))
        .pipe(z.array(assetSchema).default([...assetValues]))
        .describe("Comma-separated asset list (default: all whitelisted)."),
    }),
    defineValueOption({
      key: "timeframes",
      long: "--timeframes",
      valueName: "LIST",
      schema: z
        .string()
        .optional()
        .transform((value) => parseList(value))
        .pipe(
          z.array(resolutionTimeframeSchema).default([...defaultTimeframes]),
        )
        .describe("Comma-separated timeframes. Defaults to 1h."),
    }),
  ],
  examples: [
    "bun alea polymarket:resolutions-sync",
    "bun alea polymarket:resolutions-sync --days 30 --assets btc,eth --timeframes 1h",
  ],
  output:
    "Prints per-(asset, timeframe) counts (resolved / pending / missing / voided / errors) and the overall total.",
  sideEffects:
    "Hits gamma-api.polymarket.com `/events?slug=…` once per missing window and upserts results into the polymarket_resolutions table.",
  async run({ io, options }) {
    const end = new Date();
    const start = new Date(end.getTime() - options.days * millisecondsPerDay);

    io.writeStdout(
      `${pc.bold("alea polymarket:resolutions-sync")} ${pc.dim(start.toISOString())} → ${pc.dim(end.toISOString())}\n`,
    );
    io.writeStdout(
      `${pc.dim("assets:")} ${options.assets.join(",")}  ${pc.dim("timeframes:")} ${options.timeframes.join(",")}\n\n`,
    );

    const db = createDatabase();
    const tasks: Array<{
      asset: (typeof options.assets)[number];
      timeframe: (typeof options.timeframes)[number];
    }> = [];
    for (const asset of options.assets) {
      for (const timeframe of options.timeframes) {
        tasks.push({ asset, timeframe });
      }
    }

    const results: SyncResolutionsResult[] = [];
    const overallStart = performance.now();

    try {
      let cursor = 0;
      const worker = async (): Promise<void> => {
        while (cursor < tasks.length) {
          const idx = cursor++;
          const task = tasks[idx];
          if (task === undefined) {
            continue;
          }
          const result = await syncPolymarketResolutions({
            db,
            asset: task.asset,
            timeframe: task.timeframe,
            start,
            end,
            concurrency: perTaskConcurrency,
            onProgress: (event) => {
              if (event.kind === "task-start") {
                io.writeStdout(
                  `${pc.dim("starting")} ${pc.bold(event.asset.toUpperCase())} ${pc.cyan(event.timeframe)} ` +
                    `${pc.dim("windows=")}${event.windowCount.toLocaleString()} ${pc.dim("already_stored=")}${event.alreadyStoredCount.toLocaleString()}\n`,
                );
              }
            },
          });
          results.push(result);
          io.writeStdout(
            `${pc.bold(task.asset.toUpperCase().padEnd(5))} ${pc.cyan(task.timeframe.padEnd(4))} ` +
              `${pc.green("resolved=")}${String(result.resolved).padStart(6)} ` +
              `${pc.dim("pending=")}${String(result.pending).padStart(5)} ` +
              `${pc.dim("missing=")}${String(result.missing).padStart(6)} ` +
              `${pc.yellow("voided=")}${String(result.voided).padStart(4)} ` +
              `${result.errors > 0 ? pc.red("errors=") : pc.dim("errors=")}${String(result.errors).padStart(4)} ` +
              `${pc.dim("wall=")}${formatMs(result.elapsedMs)}\n`,
          );
        }
      };
      await Promise.all(
        Array.from(
          { length: Math.min(taskParallelism, Math.max(1, tasks.length)) },
          () => worker(),
        ),
      );
    } finally {
      await destroyDatabase(db);
    }

    const overallMs = performance.now() - overallStart;
    const totals = results.reduce(
      (acc, r) => ({
        resolved: acc.resolved + r.resolved,
        pending: acc.pending + r.pending,
        missing: acc.missing + r.missing,
        voided: acc.voided + r.voided,
        errors: acc.errors + r.errors,
      }),
      { resolved: 0, pending: 0, missing: 0, voided: 0, errors: 0 },
    );
    io.writeStdout(
      `\n${pc.green("done")}  ${pc.dim("wall=")}${formatMs(overallMs)}  ` +
        `${pc.green("resolved=")}${totals.resolved.toLocaleString()}  ` +
        `${pc.dim("pending=")}${totals.pending.toLocaleString()}  ` +
        `${pc.dim("missing=")}${totals.missing.toLocaleString()}  ` +
        `${pc.yellow("voided=")}${totals.voided.toLocaleString()}  ` +
        `${totals.errors > 0 ? pc.red("errors=") : pc.dim("errors=")}${totals.errors.toLocaleString()}\n`,
    );
  },
});

function parseList(value: string | undefined): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parts = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return parts.length > 0 ? parts : undefined;
}

function formatMs(ms: number): string {
  if (ms < 1000) {
    return `${ms.toFixed(0)}ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(2)}s`;
  }
  return `${Math.floor(ms / 60_000)}m${((ms % 60_000) / 1000).toFixed(0)}s`;
}
