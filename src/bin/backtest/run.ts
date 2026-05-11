import "@alea/lib/filters/all";

import { assetValues } from "@alea/constants/assets";
import { runBacktestForCandidate } from "@alea/lib/backtest/runBacktest";
import { defineCommand } from "@alea/lib/cli/defineCommand";
import { defineValueOption } from "@alea/lib/cli/defineValueOption";
import { createDatabase } from "@alea/lib/db/createDatabase";
import { destroyDatabase } from "@alea/lib/db/destroyDatabase";
import { allCandidates } from "@alea/lib/filters/registry";
import type { FilterBar } from "@alea/lib/filters/types";
import type { Asset } from "@alea/types/assets";
import { assetSchema } from "@alea/types/assets";
import type { CandleTimeframe } from "@alea/types/candles";
import { candleTimeframeSchema } from "@alea/types/candles";
import pc from "picocolors";
import { z } from "zod";

const SUPPORTED_PERIODS: readonly CandleTimeframe[] = ["5m", "15m"];

/**
 * Runs every registered filter at every default config across the
 * (period × asset) grid. Results land in the `filter_runs` Postgres
 * table; reruns skip whichever (candidate, period, asset) tuples
 * already have a row covering the requested candle range.
 *
 * Side effects: reads `candles` (pyth/spot only — that's the
 * source we backfilled for the new framework), upserts into
 * `filter_runs`. No network.
 */
export const backtestRunCommand = defineCommand({
  name: "backtest:run",
  summary: "Run every registered filter × default config × (period × asset)",
  description:
    "Walks pyth/spot candles for each (filter, config, period, asset) combination produced by `filters/all` and accumulates next-bar prediction stats into the `filter_runs` table. Cached: rows whose `range_last_ms` already covers the available candles are skipped. Use `--force` to recompute even when a cached row exists.",
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
        .pipe(z.array(candleTimeframeSchema).default([...SUPPORTED_PERIODS]))
        .describe(
          `Candle periods to evaluate (default: ${SUPPORTED_PERIODS.join(",")}).`,
        ),
    }),
    defineValueOption({
      key: "assets",
      long: "--assets",
      valueName: "LIST",
      schema: z
        .string()
        .optional()
        .transform((v) =>
          v === undefined ? undefined : v.split(",").map((s) => s.trim()),
        )
        .pipe(z.array(assetSchema).default([...assetValues]))
        .describe("Comma-separated asset list (default: all whitelisted)."),
    }),
    defineValueOption({
      key: "filters",
      long: "--filters",
      valueName: "LIST",
      schema: z
        .string()
        .optional()
        .transform((v) =>
          v === undefined ? undefined : v.split(",").map((s) => s.trim()),
        )
        .pipe(z.array(z.string()).default([]))
        .describe(
          "Restrict to these filter ids (default: every registered filter).",
        ),
    }),
  ],
  examples: [
    "bun alea backtest:run",
    "bun alea backtest:run --periods 5m --assets btc,eth",
    "bun alea backtest:run --filters rsi_meanrev,zscore_reversion",
  ],
  output:
    "One line per (filter, config, period, asset): engagement count, win count, win rate.",
  sideEffects:
    "Reads `candles` (pyth/spot only). Upserts into `filter_runs`. No network.",
  async run({ io, options }) {
    const candidates = allCandidates();
    const restrictTo =
      options.filters.length > 0 ? new Set(options.filters) : null;
    const selected =
      restrictTo === null
        ? candidates
        : candidates.filter((c) => restrictTo.has(c.filterId));
    if (selected.length === 0) {
      io.writeStdout(pc.yellow("no candidates matched filter list\n"));
      return;
    }

    io.writeStdout(
      `${pc.bold("backtest:run")} ${pc.dim(`candidates=${selected.length}  periods=${options.periods.join(",")}  assets=${options.assets.join(",")}`)}\n\n`,
    );

    const db = createDatabase();
    try {
      for (const period of options.periods) {
        for (const asset of options.assets) {
          const bars = await loadBars({ db, asset, period });
          if (bars.length < 2) {
            io.writeStdout(
              `  ${pc.yellow(`skip ${period}/${asset}: only ${bars.length} bars`)}\n`,
            );
            continue;
          }
          io.writeStdout(
            `${pc.bold(`${period}/${asset}`)} ${pc.dim(`bars=${bars.length}`)}\n`,
          );
          for (const cand of selected) {
            const result = await runBacktestForCandidate({
              db,
              candidate: cand,
              period,
              asset,
              bars,
            });
            const tag = result.fromCache ? pc.dim("(cached)") : pc.green("•");
            const upWr =
              result.stats.nEngagementsUp === 0
                ? "—"
                : `${((100 * result.stats.nWinsUp) / result.stats.nEngagementsUp).toFixed(1)}%`;
            const downWr =
              result.stats.nEngagementsDown === 0
                ? "—"
                : `${((100 * result.stats.nWinsDown) / result.stats.nEngagementsDown).toFixed(1)}%`;
            const totalEngagements =
              result.stats.nEngagementsUp + result.stats.nEngagementsDown;
            const totalWins = result.stats.nWinsUp + result.stats.nWinsDown;
            const overallWr =
              totalEngagements === 0
                ? "—"
                : `${((100 * totalWins) / totalEngagements).toFixed(1)}%`;
            io.writeStdout(
              `  ${tag} ${pc.bold(cand.filterId.padEnd(22))} ${pc.dim(cand.configCanon.padEnd(50))} ` +
                `engagements=${String(totalEngagements).padStart(6)} wr=${overallWr.padStart(6)} ` +
                `(up ${String(result.stats.nEngagementsUp).padStart(5)}/${upWr.padStart(6)}  ` +
                `down ${String(result.stats.nEngagementsDown).padStart(5)}/${downWr.padStart(6)})\n`,
            );
          }
        }
      }
    } finally {
      await destroyDatabase(db);
    }
  },
});

async function loadBars({
  db,
  asset,
  period,
}: {
  readonly db: ReturnType<typeof createDatabase>;
  readonly asset: Asset;
  readonly period: CandleTimeframe;
}): Promise<readonly FilterBar[]> {
  const rows = await db
    .selectFrom("candles")
    .select(["timestamp", "open", "high", "low", "close", "volume"])
    .where("source", "=", "pyth")
    .where("product", "=", "spot")
    .where("asset", "=", asset)
    .where("timeframe", "=", period)
    .orderBy("timestamp", "asc")
    .execute();
  return rows.map((r) => ({
    openTimeMs:
      r.timestamp instanceof Date
        ? r.timestamp.getTime()
        : new Date(r.timestamp).getTime(),
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    volume: r.volume,
  }));
}
