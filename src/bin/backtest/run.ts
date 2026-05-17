import {
  CANDIDATE_BACKTEST_ASSETS,
  CANDIDATE_BACKTEST_END_EXCLUSIVE_MS,
  CANDIDATE_BACKTEST_PERIODS,
  CANDIDATE_BACKTEST_START_MS,
} from "@alea/constants/backtest";
import {
  TRADE_DECISION_SUPPORTED_PERIODS,
  TRADE_DECISION_TRADABLE_ASSETS,
  type TradeDecisionPeriod,
} from "@alea/constants/tradeDecision";
import { runCandidateBacktest } from "@alea/lib/backtest/runCandidateBacktest";
import { defineCommand } from "@alea/lib/cli/defineCommand";
import { defineValueOption } from "@alea/lib/cli/defineValueOption";
import { createDatabase } from "@alea/lib/db/createDatabase";
import { destroyDatabase } from "@alea/lib/db/destroyDatabase";
import { registeredCandidatesForMarket } from "@alea/lib/filters/registry";
import type { Asset } from "@alea/types/assets";
import pc from "picocolors";
import { z } from "zod";

const tradeDecisionPeriodSchema = z.enum(TRADE_DECISION_SUPPORTED_PERIODS);
const tradeDecisionAssetSchema = z.enum(TRADE_DECISION_TRADABLE_ASSETS);

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
  .pipe(z.array(tradeDecisionAssetSchema).min(1).optional());

export const backtestRunCommand = defineCommand({
  name: "backtest:run",
  summary: "Backtest registered filter candidates",
  description:
    "Evaluates the filter candidates registered for each selected timeframe against stored Pyth candles. The simulator makes each decision at the same pre-open lead time as dry-run/live trading and builds the active candle only from stored 1m bars available by that decision timestamp.",
  options: [
    defineValueOption({
      key: "periods",
      long: "--periods",
      valueName: "LIST",
      schema: commaSeparatedPeriodsSchema.describe(
        `Comma-separated periods. Defaults to ${CANDIDATE_BACKTEST_PERIODS.join(",")}.`,
      ),
    }),
    defineValueOption({
      key: "assets",
      long: "--assets",
      valueName: "LIST",
      schema: commaSeparatedAssetsSchema.describe(
        `Comma-separated assets. Defaults to ${CANDIDATE_BACKTEST_ASSETS.join(",")}.`,
      ),
    }),
    defineValueOption({
      key: "start",
      long: "--start",
      valueName: "YYYY-MM-DD",
      schema: z
        .string()
        .optional()
        .transform((value) =>
          value === undefined
            ? CANDIDATE_BACKTEST_START_MS
            : parseDateMs(value),
        )
        .describe("Inclusive UTC start date."),
    }),
    defineValueOption({
      key: "end",
      long: "--end",
      valueName: "YYYY-MM-DD",
      schema: z
        .string()
        .optional()
        .transform((value) =>
          value === undefined
            ? (CANDIDATE_BACKTEST_END_EXCLUSIVE_MS ?? Date.now())
            : parseDateMs(value),
        )
        .describe("Exclusive UTC end date. Defaults to now."),
    }),
  ],
  examples: [
    "bun alea backtest:run",
    "bun alea backtest:run --periods 5m --assets btc,eth",
    "bun alea backtest:run --start 2024-04-01 --end 2026-05-01",
  ],
  output:
    "Prints per-market generated/skipped row counts and a final decision total. Results are persisted by candidate, asset, timeframe, and quarter.",
  sideEffects:
    "Reads stored Pyth 1m/5m/15m candles and upserts missing or stale rows into `candidate_backtest_quarter_results`.",
  async run({ io, options }) {
    const assets = (options.assets ??
      CANDIDATE_BACKTEST_ASSETS) as readonly Asset[];
    const periods = (options.periods ??
      CANDIDATE_BACKTEST_PERIODS) as readonly TradeDecisionPeriod[];
    if (options.end <= options.start) {
      throw new Error("--end must be after --start");
    }
    io.writeStdout(
      `${pc.bold("backtest:run")} ${pc.dim(`${new Date(options.start).toISOString()} -> ${new Date(options.end).toISOString()}`)}\n`,
    );
    io.writeStdout(
      `${pc.dim("assets=")}${assets.join(",")} ${pc.dim("periods=")}${periods.join(",")} ${pc.dim("candidates=")}${candidateSummary({ assets, periods })}\n\n`,
    );
    const db = createDatabase();
    try {
      const result = await runCandidateBacktest({
        db,
        assets,
        periods,
        startMs: options.start,
        endMs: options.end,
        log: (event) => {
          if (event.kind === "skip") {
            io.writeStdout(
              `${pc.yellow("skip")} ${event.period}/${event.asset} ${pc.dim(event.reason)}\n`,
            );
            return;
          }
          io.writeStdout(
            `${pc.green("done")} ${event.period}/${event.asset} ${pc.dim(`targets=${event.targetCount.toLocaleString()} generated=${event.rowCount.toLocaleString()} cached=${event.skippedRowCount.toLocaleString()}`)}\n`,
          );
        },
      });
      io.writeStdout(
        `\n${pc.green("persisted")} ${result.rowsWritten.toLocaleString()} rows ${pc.dim(`cached=${result.rowsSkipped.toLocaleString()} markets=${result.markets} decisions=${result.decisions.toLocaleString()}`)}\n`,
      );
    } finally {
      await destroyDatabase(db);
    }
  },
});

function candidateSummary({
  assets,
  periods,
}: {
  readonly assets: readonly Asset[];
  readonly periods: readonly TradeDecisionPeriod[];
}): string {
  return periods
    .flatMap((period) =>
      assets.map(
        (asset) =>
          `${period}/${asset}:${registeredCandidatesForMarket({ asset, period }).length}`,
      ),
    )
    .join(",");
}

function parseDateMs(value: string): number {
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(ms)) {
    throw new Error(`invalid date: ${value}`);
  }
  return ms;
}
