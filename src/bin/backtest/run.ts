import "@alea/lib/filters/all";

import { assetValues } from "@alea/constants/assets";
import {
  TRAINING_WINDOW_END_EXCLUSIVE_MS,
  TRAINING_WINDOW_END_INCLUSIVE_MS,
  TRAINING_WINDOW_START_POLICY,
} from "@alea/constants/researchWindows";
import { runBacktestForCandidate } from "@alea/lib/backtest/runBacktest";
import { loadAlignedBarSeries } from "@alea/lib/candles/loadAlignedBarSeries";
import { defineCommand } from "@alea/lib/cli/defineCommand";
import { defineValueOption } from "@alea/lib/cli/defineValueOption";
import { createDatabase } from "@alea/lib/db/createDatabase";
import { destroyDatabase } from "@alea/lib/db/destroyDatabase";
import type { AlignedBarSeries } from "@alea/lib/filters/barSeries";
import { allCandidates } from "@alea/lib/filters/registry";
import type { Asset } from "@alea/types/assets";
import { assetSchema } from "@alea/types/assets";
import pc from "picocolors";
import { z } from "zod";

const SUPPORTED_PERIODS = ["5m", "15m"] as const;
const supportedPeriodSchema = z.enum(SUPPORTED_PERIODS);
type SupportedPeriod = (typeof SUPPORTED_PERIODS)[number];

/**
 * Runs every registered filter at every default config across the
 * (period × asset) grid inside the configured training window. Results
 * land in the `filter_runs` Postgres table; reruns skip whichever
 * (candidate, period, asset) tuples already have an exact active-profile
 * row for that window.
 *
 * Side effects: reads `candles` (pyth/spot only — that's the
 * source we backfilled for the new framework), upserts into
 * `filter_runs`. No network.
 */
export const trainingRunCommand = defineCommand({
  name: "training:run",
  summary: "Refresh filter training artifacts for every active candidate",
  description:
    "Walks pyth/spot candles inside the configured training window for each (filter, config, period, asset) combination produced by `filters/all` and accumulates next-bar prediction stats into the `filter_runs` table. Cached: rows whose stored window exactly matches the configured training window and active training profile are skipped.",
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
        .pipe(z.array(supportedPeriodSchema).default([...SUPPORTED_PERIODS]))
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
    "bun alea training:run",
    "bun alea training:run --periods 5m --assets btc,eth",
    "bun alea training:run --filters rsi_meanrev,zscore_reversion",
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
      `${pc.bold("training artifacts")} ${pc.dim(`command=training:run  candidates=${selected.length}  periods=${options.periods.join(",")}  assets=${options.assets.join(",")}`)}\n\n`,
    );
    io.writeStdout(
      `${pc.dim("training window:")} ${formatTrainingWindowForCli()}\n\n`,
    );

    const db = createDatabase();
    try {
      for (const period of options.periods) {
        for (const asset of options.assets) {
          const series = await loadTrainingSeries({ db, asset, period });
          if (series.pyth.length < 2) {
            io.writeStdout(
              `  ${pc.yellow(`skip ${period}/${asset}: only ${series.pyth.length} pyth bars`)}\n`,
            );
            continue;
          }
          const coinbaseCovered = countNonNull({
            arr: series.coinbase,
          });
          io.writeStdout(
            `${pc.bold(`${period}/${asset}`)} ${pc.dim(`bars=${series.pyth.length}  coinbase=${coinbaseCovered}`)}\n`,
          );
          for (const cand of selected) {
            const result = await runBacktestForCandidate({
              db,
              candidate: cand,
              period,
              asset,
              series,
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

async function loadTrainingSeries({
  db,
  asset,
  period,
}: {
  readonly db: ReturnType<typeof createDatabase>;
  readonly asset: Asset;
  readonly period: SupportedPeriod;
}): Promise<AlignedBarSeries> {
  return loadAlignedBarSeries({
    db,
    asset,
    timeframe: period,
    windowEndExclusiveMs: TRAINING_WINDOW_END_EXCLUSIVE_MS,
  });
}

function countNonNull<T>({ arr }: { readonly arr: readonly (T | null)[] }): number {
  let n = 0;
  for (const v of arr) {
    if (v !== null) {
      n += 1;
    }
  }
  return n;
}

function formatTrainingWindowForCli(): string {
  return `${TRAINING_WINDOW_START_POLICY.replaceAll("_", " ")} -> ${new Date(TRAINING_WINDOW_END_INCLUSIVE_MS).toISOString()}`;
}
