import { env } from "@alea/constants/env";
import { MIN_EDGE } from "@alea/constants/trading";
import { CliUsageError } from "@alea/lib/cli/CliUsageError";
import { defineCommand } from "@alea/lib/cli/defineCommand";
import { defineValueOption } from "@alea/lib/cli/defineValueOption";
import { formatDryRunEvent } from "@alea/lib/trading/dryRun/formatDryRunEvent";
import { runDryRun } from "@alea/lib/trading/dryRun/runDryRun";
import { researchChallengerStrategy } from "@alea/lib/trading/strategy/researchChallenger";
import { createPolymarketVendor } from "@alea/lib/trading/vendor/polymarket/createPolymarketVendor";
import { assetSchema } from "@alea/types/assets";
import pc from "picocolors";
import { z } from "zod";

/**
 * Long-running dry trader. No orders are placed and no auth is
 * exercised. The daemon connects to the same live price source as the
 * live trader, discovers current Polymarket markets, subscribes to the
 * public market-data websocket, evaluates the current research
 * challenger, and simulates real-depth taker fills.
 */
export const tradingDryRunCommand = defineCommand({
  name: "trading:dry-run",
  summary: "Simulate live trading against real feeds without placing orders",
  description:
    "Loads the committed 4-source research-challenger probability tables, hydrates moving trackers from the configured live price source, opens live price and Polymarket public market-data websockets, runs the same consensus decision path as trading:live, and simulates real-depth taker fills instead of signing or posting orders. Sends Telegram alerts for virtual orders and per-window dry summaries, appends JSONL session/window records under tmp/dry-trading/, and exits cleanly on SIGINT.",
  options: [
    defineValueOption({
      key: "assets",
      long: "--assets",
      valueName: "LIST",
      schema: z
        .string()
        .optional()
        .transform((value) => parseList(value))
        .pipe(
          z.array(assetSchema).default([...researchChallengerStrategy.assets]),
        )
        .describe(
          "Comma-separated asset list (default: research challenger roster).",
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
          `Minimum edge over Polymarket bid to mark as TAKE in the log (default ${MIN_EDGE.toFixed(3)}).`,
        ),
    }),
  ],
  examples: [
    "bun alea trading:dry-run",
    "bun alea trading:dry-run --assets btc,eth",
    "bun alea trading:dry-run --min-edge 0.08",
  ],
  output:
    "Streams a one-line-per-event log: boot status, ws/connect cycles, per-minute decisions, virtual orders/fills, and multi-line finalized dry-window summaries with session totals. Sends the same virtual-order and window-summary bodies to Telegram. Writes a timestamped JSONL session log under tmp/dry-trading/.",
  sideEffects:
    "Opens live price and Polymarket public market-data WebSockets; calls price-source REST at boot and settlement; polls Polymarket gamma-api/CLOB read endpoints; sends Telegram messages using TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID; appends JSONL files under alea/tmp/dry-trading/. No orders are placed, cancelled, signed, or authenticated.",
  async run({ io, options }) {
    const primaryTable = researchChallengerStrategy.tables[0]?.table;
    if (primaryTable === undefined || primaryTable.assets.length === 0) {
      throw new CliUsageError(
        "research challenger probability tables are empty — regenerate the committed table artifact first.",
      );
    }
    const telegramBotToken = env.telegramBotToken;
    const telegramChatId = env.telegramChatId;
    if (telegramBotToken === undefined || telegramChatId === undefined) {
      throw new CliUsageError(
        "TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set; the dry trader sends virtual-placement and window-summary alerts on every cycle.",
      );
    }

    const controller = new AbortController();
    const onSigint = () => {
      io.writeStdout("\n");
      io.writeStdout(pc.dim("received SIGINT, shutting down...\n"));
      controller.abort();
    };
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigint);

    try {
      const vendor = await createPolymarketVendor();
      await runDryRun({
        vendor,
        assets: options.assets,
        table: primaryTable,
        decisionEvaluator: researchChallengerStrategy.decisionEvaluator,
        strategyLabel: researchChallengerStrategy.label,
        placementMode: researchChallengerStrategy.placementMode,
        minEdge: options.minEdge,
        telegramBotToken,
        telegramChatId,
        signal: controller.signal,
        emit: (event) => {
          io.writeStdout(`${formatDryRunEvent({ event })}\n`);
        },
      });
    } finally {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigint);
    }
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
