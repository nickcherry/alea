import { env } from "@alea/constants/env";
import {
  formatTradeDecisionMarkets,
  resolveTradeDecisionMarkets,
  TRADE_DECISION_DEFAULT_ASSETS,
  TRADE_DECISION_DEFAULT_MARKETS,
  TRADE_DECISION_SUPPORTED_PERIODS,
  TRADE_DECISION_TRADABLE_ASSETS,
} from "@alea/constants/tradeDecision";
import { defineCommand } from "@alea/lib/cli/defineCommand";
import { defineValueOption } from "@alea/lib/cli/defineValueOption";
import { createDatabase } from "@alea/lib/db/createDatabase";
import { destroyDatabase } from "@alea/lib/db/destroyDatabase";
import { type DryRunLogEvent, runDryRun } from "@alea/lib/dryRun/runDryRun";
import { sendTelegramMessage } from "@alea/lib/telegram/sendTelegramMessage";
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

/**
 * Boots the dry-run trader loop. Hydrates per-asset bar history from
 * the `candles` table, refreshes recent Pyth candles before each
 * configured period boundary, synthesizes the active candle from the
 * latest Pyth price, and asks OpenAI to predict from the rendered
 * chart. Inverse OpenAI green/red decisions land in `dry_run_decisions`; the
 * configured pre-open Polymarket order is simulated; outcomes are scored once
 * the target bar finalizes.
 *
 * Stays running until SIGINT / SIGTERM. Intended to live in a
 * long-running tmux / background session.
 */
export const dryRunCommand = defineCommand({
  name: "dry:run",
  summary: "Run OpenAI chart decisions in dry-run mode",
  description:
    "Long-running process. Hydrates bar history from `candles`, refreshes recent Pyth candles before each configured boundary (5m at T-2m, 15m at T-3m), synthesizes the active candle from the latest Pyth price, renders a chart, and uses OpenAI to predict the next bar's direction. The inverse of every returned green/red prediction lands in `dry_run_decisions`; the configured pre-open Polymarket order is simulated immediately after the decision; outcomes auto-score when the target bar closes.",
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
    "bun alea dry:run",
    "bun alea dry:run --periods 15m",
    "bun alea dry:run --assets eth --periods 5m,15m",
  ],
  output:
    "Streams decision, simulated-order, and outcome events to stdout. Persists to the `dry_run_decisions` table.",
  sideEffects:
    "Fetches Pyth candles/latest prices, renders chart images, calls the OpenAI Responses API, and opens Polymarket market-data connections for order simulation. Reads from `candles`, writes to `dry_run_decisions`. Runs until killed.",
  async run({ io, options }) {
    const markets = resolveTradeDecisionMarkets({
      assets: options.assets,
      periods: options.periods,
    });
    if (env.openaiApiKey === undefined) {
      throw new Error("OPENAI_API_KEY is required for dry-run decisions.");
    }
    io.writeStdout(
      `${pc.bold("dry:run")} ${pc.dim(`markets=${formatTradeDecisionMarkets({ markets })}`)}\n\n`,
    );
    const sendOutcomeTelegram = createDryRunOutcomeTelegramSender({ io });
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
        markets,
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
              const reason =
                event.reasoning === null ? "" : ` reason=${event.reasoning}`;
              io.writeStdout(
                `${pc.dim(ts)} ${tag} ${event.period}/${event.asset.padEnd(5)} target=${new Date(event.tsMs).toISOString().slice(11, 16)} synth=${event.synthClose.toFixed(2)} ${pc.dim("source=openai model=" + (event.model ?? "-") + reason)}\n`,
              );
              break;
            }
            case "outcome": {
              const tag = event.won ? pc.green("WIN ") : pc.red("LOSS");
              io.writeStdout(
                `${pc.dim(ts)} ${tag} ${event.period}/${event.asset.padEnd(5)} bar=${new Date(event.tsMs).toISOString().slice(11, 16)} pred=${event.prediction} open=${event.actualOpen.toFixed(2)} close=${event.actualClose.toFixed(2)} order=${event.orderStatus}\n`,
              );
              void sendOutcomeTelegram(event);
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
                parts.push(`conf=${formatConfidence(event.confidence)}`);
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

function formatConfidence(value: number): string {
  return value.toFixed(2);
}

type DryRunOutcomeEvent = Extract<DryRunLogEvent, { readonly kind: "outcome" }>;

type DryRunOutcomeTelegramStats = {
  wins: number;
  losses: number;
  filled: number;
  unfilled: number;
  skipped: number;
  open: number;
};

function createDryRunOutcomeTelegramSender({
  io,
}: {
  readonly io: { readonly writeStdout: (text: string) => void };
}): (event: DryRunOutcomeEvent) => Promise<void> {
  const botToken = env.telegramBotToken;
  const chatId = env.telegramChatId;
  if (botToken === undefined || chatId === undefined) {
    io.writeStdout(
      `${pc.yellow("telegram outcomes disabled:")} TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is missing\n`,
    );
    return async () => {};
  }

  const stats: DryRunOutcomeTelegramStats = {
    wins: 0,
    losses: 0,
    filled: 0,
    unfilled: 0,
    skipped: 0,
    open: 0,
  };

  return async (event: DryRunOutcomeEvent): Promise<void> => {
    updateOutcomeTelegramStats({ stats, event });
    const text = formatDryRunOutcomeTelegram({ event, stats });
    try {
      await sendTelegramMessage({ botToken, chatId, text });
    } catch (error) {
      io.writeStdout(
        `${pc.yellow("telegram outcome failed:")} ${(error as Error).message}\n`,
      );
    }
  };
}

function updateOutcomeTelegramStats({
  stats,
  event,
}: {
  readonly stats: DryRunOutcomeTelegramStats;
  readonly event: DryRunOutcomeEvent;
}): void {
  if (event.won) {
    stats.wins += 1;
  } else {
    stats.losses += 1;
  }

  switch (event.orderStatus) {
    case "filled":
      stats.filled += 1;
      break;
    case "unfilled":
      stats.unfilled += 1;
      break;
    case "placed":
    case "pending_placement":
      stats.open += 1;
      break;
    default:
      if (event.orderStatus.startsWith("skipped")) {
        stats.skipped += 1;
      }
      break;
  }
}

function formatDryRunOutcomeTelegram({
  event,
  stats,
}: {
  readonly event: DryRunOutcomeEvent;
  readonly stats: DryRunOutcomeTelegramStats;
}): string {
  const result = event.won ? "WIN" : "LOSS";
  const direction = event.prediction === "u" ? "UP" : "DOWN";
  const moveBps =
    event.actualOpen === 0
      ? null
      : ((event.actualClose - event.actualOpen) / event.actualOpen) * 10_000;
  const priceLine =
    moveBps === null
      ? `open=${event.actualOpen.toFixed(2)} close=${event.actualClose.toFixed(2)}`
      : `open=${event.actualOpen.toFixed(2)} close=${event.actualClose.toFixed(2)} move=${moveBps.toFixed(1)}bps`;
  return [
    `Alea dry-run resolved: ${result}`,
    `${event.period}/${event.asset.toUpperCase()} target=${new Date(event.tsMs).toISOString().slice(11, 16)} pred=${direction}`,
    priceLine,
    `order=${formatTelegramOrderStatus({ event })}`,
    `session=${stats.wins} right / ${stats.losses} wrong; ${stats.filled} filled / ${stats.unfilled} unfilled / ${stats.open} open / ${stats.skipped} skipped`,
  ].join("\n");
}

function formatTelegramOrderStatus({
  event,
}: {
  readonly event: DryRunOutcomeEvent;
}): string {
  const parts: string[] = [event.orderStatus];
  if (event.orderLimitPrice !== null) {
    parts.push(`limit=${formatCents(event.orderLimitPrice)}`);
  }
  if (event.orderFillPrice !== null) {
    parts.push(`fill=${formatCents(event.orderFillPrice)}`);
  }
  return parts.join(" ");
}
