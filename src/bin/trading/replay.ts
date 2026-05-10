import { assetValues } from "@alea/constants/assets";
import { MIN_EDGE } from "@alea/constants/trading";
import { CliUsageError } from "@alea/lib/cli/CliUsageError";
import { defineCommand } from "@alea/lib/cli/defineCommand";
import { defineValueOption } from "@alea/lib/cli/defineValueOption";
import { createDatabase } from "@alea/lib/db/createDatabase";
import { destroyDatabase } from "@alea/lib/db/destroyDatabase";
import { formatUsd } from "@alea/lib/trading/format";
import { probabilityTable } from "@alea/lib/trading/probabilityTable/probabilityTable.generated";
import { formatReplayEvent } from "@alea/lib/trading/replay/formatReplayEvent";
import { runReplay } from "@alea/lib/trading/replay/runReplay";
import { singleSourceTakerStrategy } from "@alea/lib/trading/strategy/singleSourceTaker";
import { researchChallengerStrategy } from "@alea/lib/trading/strategy/researchChallenger";
import { assetSchema } from "@alea/types/assets";
import pc from "picocolors";
import { z } from "zod";

/**
 * Offline replay of the live trading decision + placement + fill
 * pipeline against a previously-captured `market_event` tape. Uses
 * the same `evaluateDecision` and `fillSimulation` modules production
 * does, so iteration on thresholds/regime gates can run in seconds
 * against weeks of recorded data instead of an overnight live dry
 * run.
 *
 * `--from` / `--to` accept ISO-8601 timestamps (e.g.
 * `2026-05-05T11:50:00Z`); when omitted we span the full range
 * present in the `market_event` table.
 */
export const tradingReplayCommand = defineCommand({
  name: "trading:replay",
  summary:
    "Replay captured market data through the live decision pipeline and emit a session JSONL",
  description:
    "Loads the committed probability table and walks every captured 5m window in the requested range, reproducing the live trader's decision evaluation, queue-aware fill simulation, and chainlink-based settlement against the market_event tape. Emits the same JSONL session shape as trading:dry-run so trading:replay-report (or trading:dry-run-report) can render the dashboard. Each window's chainlink-derived winner is cross-checked against the captured polymarket resolved event and disagreements are surfaced per-order.",
  options: [
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
      key: "from",
      long: "--from",
      valueName: "ISO",
      schema: z
        .string()
        .optional()
        .describe(
          "ISO-8601 start timestamp (default: earliest market_event row).",
        ),
    }),
    defineValueOption({
      key: "to",
      long: "--to",
      valueName: "ISO",
      schema: z
        .string()
        .optional()
        .describe(
          "ISO-8601 end timestamp (default: latest market_event row).",
        ),
    }),
    defineValueOption({
      key: "minEdge",
      long: "--min-edge",
      valueName: "X",
      schema: z.coerce
        .number()
        .min(0)
        .default(MIN_EDGE)
        .describe(
          `Minimum edge over Polymarket bid to take a trade (default ${MIN_EDGE.toFixed(3)}).`,
        ),
    }),
    defineValueOption({
      key: "candleSource",
      long: "--candle-source",
      valueName: "SOURCE",
      schema: z
        .enum(["binance", "coinbase", "coindesk", "pyth"])
        .optional()
        .describe(
          "Override the candle source used to bootstrap regime trackers (default: matches `trainingCandleSeries` — currently pyth — for parity with the trained probability table).",
        ),
    }),
    defineValueOption({
      key: "candleProduct",
      long: "--candle-product",
      valueName: "PRODUCT",
      schema: z
        .enum(["spot", "perp"])
        .optional()
        .describe(
          "Override the candle product used to bootstrap regime trackers (default: perp).",
        ),
    }),
    defineValueOption({
      key: "tickSource",
      long: "--tick-source",
      valueName: "SOURCE",
      schema: z
        .enum(["binance-perp", "coinbase-spot", "coinbase-perp", "pyth-spot"])
        .optional()
        .describe(
          "Captured BBO stream consumed for in-window line capture and lastTick (default: derived from `trainingCandleSeries` — currently pyth-spot now that pyth ticks are captured by `data:capture`).",
        ),
    }),
    defineValueOption({
      key: "cancelOnAdverseBp",
      long: "--cancel-on-adverse-bp",
      valueName: "BP",
      schema: z.coerce
        .number()
        .min(0)
        .default(0)
        .describe(
          "Cancel a placed order when the underlying tick mid moves ≥ N bp against our predicted side (default 0 = no cancellation).",
        ),
    }),
    defineValueOption({
      key: "strategy",
      long: "--strategy",
      valueName: "STRATEGY",
      schema: z
        .enum(["single-source", "consensus", "single-table"])
        .default("single-source")
        .describe(
          "Decision strategy. `single-source` (default) runs the production single-source strategy (currently pyth/spot) + execution-quality gates. `consensus` runs the legacy 4-source research-challenger consensus. `single-table` runs the bare `evaluateDecision` against `probabilityTable.generated.ts` with no execution-quality gates (diagnostic only).",
        ),
    }),
    defineValueOption({
      key: "placementMode",
      long: "--placement-mode",
      valueName: "MODE",
      schema: z
        .enum(["taker", "maker"])
        .default("taker")
        .describe(
          "Placement model. `taker` (default) mirrors live FAK execution: walk asks, instant-fill at depth-weighted price. `maker` keeps the legacy queue-aware limit-order simulator.",
        ),
    }),
  ],
  examples: [
    "bun alea trading:replay",
    "bun alea trading:replay --from 2026-05-05T11:50:00Z --to 2026-05-05T12:05:00Z",
    "bun alea trading:replay --assets btc,eth --min-edge 0.06",
  ],
  output:
    "Streams a per-event log mirroring trading:dry-run plus the manifest+chainlink load progress, and writes a JSONL session file under tmp/replay-trading/. Final line gives windows processed/skipped, canonical PnL, and the JSONL path.",
  sideEffects:
    "Reads `market_event` and `candles` from the local Postgres. Writes one JSONL file under alea/tmp/replay-trading/. No network calls, no orders placed, no auth.",
  async run({ io, options }) {
    if (probabilityTable.assets.length === 0) {
      throw new CliUsageError(
        "probability table is empty — run `bun alea trading:gen-probability-table` first.",
      );
    }

    const db = createDatabase();
    try {
      const range = await resolveRange({
        db,
        explicitFrom: options.from,
        explicitTo: options.to,
      });
      io.writeStdout(
        `${pc.bold("trading:replay")}  ${pc.dim("from=")}${new Date(range.fromMs).toISOString()}  ${pc.dim("to=")}${new Date(range.toMs).toISOString()}  ${pc.dim("assets=")}${options.assets.join(",")}  ${pc.dim("strategy=")}${options.strategy}  ${pc.dim("placement=")}${options.placementMode}\n`,
      );

      const controller = new AbortController();
      const onSigint = () => {
        io.writeStdout("\n");
        io.writeStdout(pc.dim("received SIGINT, finishing current window then stopping...\n"));
        controller.abort();
      };
      process.once("SIGINT", onSigint);
      process.once("SIGTERM", onSigint);

      try {
        const result = await runReplay({
          db,
          assets: options.assets,
          fromMs: range.fromMs,
          toMs: range.toMs,
          table: probabilityTable,
          minEdge: options.minEdge,
          placementMode: options.placementMode,
          ...(options.strategy === "consensus"
            ? { decisionEvaluator: researchChallengerStrategy.decisionEvaluator }
            : options.strategy === "single-source"
              ? { decisionEvaluator: singleSourceTakerStrategy.decisionEvaluator }
              : {}),
          signal: controller.signal,
          ...(options.candleSource !== undefined
            ? { candleSource: options.candleSource }
            : {}),
          ...(options.candleProduct !== undefined
            ? { candleProduct: options.candleProduct }
            : {}),
          ...(options.tickSource !== undefined
            ? { tickSource: options.tickSource }
            : {}),
          ...(options.cancelOnAdverseBp > 0
            ? { cancelOnAdverseBp: options.cancelOnAdverseBp }
            : {}),
          emit: (event) => {
            // Suppress per-evaluation `decision` and per-fill events
            // from the console — they fire thousands of times per
            // window and dominate runtime through stdout overhead.
            // The full ledger is in the JSONL output for the report.
            if (
              event.kind === "decision" ||
              event.kind === "virtual-fill"
            ) {
              return;
            }
            io.writeStdout(`${formatReplayEvent({ event })}\n`);
          },
        });
        const m = result.sessionMetrics;
        io.writeStdout(
          `\n${pc.green("replay complete")}  ${pc.dim("windows=")}${result.windowsProcessed} ${pc.dim("skipped=")}${result.windowsSkipped}\n` +
            `  ${pc.dim("canonical:")} pnl=${formatUsd({ value: m.canonical.pnlUsd })} fills=${m.canonical.filledCount}/${m.orderCount}\n` +
            `  ${pc.dim("touch:")} pnl=${formatUsd({ value: m.touch.pnlUsd })} fills=${m.touch.filledCount}/${m.orderCount}\n` +
            `  ${pc.dim("all-orders-filled:")} pnl=${formatUsd({ value: m.allOrdersFilled.pnlUsd })}\n` +
            `  ${pc.dim("disagreements (chainlink vs polymarket):")} ${m.officialProxyDisagreementCount}\n` +
            `  ${pc.dim("log:")} ${result.logPath}\n`,
        );
      } finally {
        process.off("SIGINT", onSigint);
        process.off("SIGTERM", onSigint);
      }
    } finally {
      await destroyDatabase(db);
    }
  },
});

async function resolveRange({
  db,
  explicitFrom,
  explicitTo,
}: {
  readonly db: ReturnType<typeof createDatabase>;
  readonly explicitFrom: string | undefined;
  readonly explicitTo: string | undefined;
}): Promise<{ readonly fromMs: number; readonly toMs: number }> {
  const fromMs = explicitFrom !== undefined ? parseIsoMs(explicitFrom) : null;
  const toMs = explicitTo !== undefined ? parseIsoMs(explicitTo) : null;
  if (fromMs !== null && toMs !== null) {
    if (toMs <= fromMs) {
      throw new CliUsageError(
        `--to (${explicitTo}) must be after --from (${explicitFrom}).`,
      );
    }
    return { fromMs, toMs };
  }
  const bounds = await db
    .selectFrom("market_event")
    .select((eb) => [
      eb.fn.min("ts_ms").as("min_ts"),
      eb.fn.max("ts_ms").as("max_ts"),
    ])
    .executeTakeFirst();
  if (
    bounds === undefined ||
    bounds.min_ts === null ||
    bounds.max_ts === null
  ) {
    throw new CliUsageError(
      "market_event table is empty — capture some data first via `bun alea data:capture`.",
    );
  }
  return {
    fromMs: fromMs ?? Number(bounds.min_ts),
    toMs: toMs ?? Number(bounds.max_ts),
  };
}

function parseIsoMs(value: string): number {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new CliUsageError(
      `could not parse '${value}' as an ISO-8601 timestamp`,
    );
  }
  return ms;
}

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

