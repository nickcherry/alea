import { env } from "@alea/constants/env";
import { TRADE_DECISION_DEFAULT_ASSETS } from "@alea/constants/tradeDecision";
import { defineCommand } from "@alea/lib/cli/defineCommand";
import { defineFlagOption } from "@alea/lib/cli/defineFlagOption";
import { defineValueOption } from "@alea/lib/cli/defineValueOption";
import { createDatabase } from "@alea/lib/db/createDatabase";
import { destroyDatabase } from "@alea/lib/db/destroyDatabase";
import {
  type PriceSamplerLogEvent,
  runPolymarketPriceSampler,
} from "@alea/lib/polymarket/priceSampler";
import { sendTelegramMessage } from "@alea/lib/telegram/sendTelegramMessage";
import { assetSchema } from "@alea/types/assets";
import { resolutionTimeframeSchema } from "@alea/types/resolutions";
import pc from "picocolors";
import { z } from "zod";

const defaultOneHourIntervalMs = 60_000;
const defaultTelegramStatusMinutes = 5;
const errorTelegramThrottleMs = 10 * 60_000;
const defaultTimeframes = ["1h"] as const;
type PersistedMarket = NonNullable<PriceSamplerLogEvent["persistedMarket"]>;

export const polymarketPriceSampleCommand = defineCommand({
  name: "polymarket:price-sample",
  summary: "Sample live Polymarket up/down prices into compact DB blobs",
  description:
    "Long-running sampler for live Polymarket crypto up/down markets. Discovers active 1h markets by default, subscribes to the public market-data websocket, samples the normalized UP contract price on a fixed cadence, and writes one compact DB blob per market at market end.",
  options: [
    defineValueOption({
      key: "assets",
      long: "--assets",
      valueName: "LIST",
      schema: z
        .string()
        .optional()
        .transform((value) => parseList(value))
        .pipe(z.array(assetSchema).default([...TRADE_DECISION_DEFAULT_ASSETS]))
        .describe(
          "Comma-separated asset list (default: current trading assets).",
        ),
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
    defineValueOption({
      key: "oneHourIntervalMs",
      long: "--1h-interval-ms",
      valueName: "MS",
      schema: z.coerce
        .number()
        .int()
        .positive()
        .default(defaultOneHourIntervalMs)
        .describe("Sample cadence for 1h markets in milliseconds."),
    }),
    defineFlagOption({
      key: "telegram",
      long: "--telegram",
      schema: z
        .boolean()
        .default(false)
        .describe(
          "Send startup, periodic, error, and shutdown status messages via Telegram.",
        ),
    }),
    defineValueOption({
      key: "telegramStatusMinutes",
      long: "--telegram-status-minutes",
      valueName: "N",
      schema: z.coerce
        .number()
        .positive()
        .default(defaultTelegramStatusMinutes)
        .describe(
          "Telegram heartbeat interval in minutes when --telegram is set.",
        ),
    }),
  ],
  examples: [
    "bun alea polymarket:price-sample",
    "bun alea polymarket:price-sample --assets btc,eth --timeframes 1h",
    "bun alea polymarket:price-sample --timeframes 1h --1h-interval-ms 60000",
    "bun alea polymarket:price-sample --telegram --telegram-status-minutes 5",
  ],
  output:
    "Streams state-change log lines: market discovery, websocket connect/disconnect, persisted market blobs, and errors.",
  sideEffects:
    "Calls gamma-api.polymarket.com for market discovery, opens the public Polymarket market websocket, writes completed market blobs to polymarket_price_samples, and optionally sends Telegram status messages.",
  async run({ io, options }) {
    const controller = new AbortController();
    const onSignal = (signalName: string) => () => {
      io.writeStdout(
        `\n${pc.dim(`received ${signalName}, shutting down...`)}\n`,
      );
      controller.abort();
    };
    const onSigint = onSignal("SIGINT");
    const onSigterm = onSignal("SIGTERM");
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);

    const stats = {
      startedAtMs: Date.now(),
      persistedMarkets: 0,
      persistedSamples: 0,
      missingSamples: 0,
      lastPersistedMarket: null as PersistedMarket | null,
    };

    const sendTelegramStatus = createTelegramStatusSender({
      enabled: options.telegram,
      io,
      stats,
      assets: options.assets,
      timeframes: options.timeframes,
    });
    let nextTelegramErrorStatusAtMs = 0;

    const db = createDatabase();
    const telegramTimer =
      options.telegram && options.telegramStatusMinutes > 0
        ? setInterval(() => {
            void sendTelegramStatus("heartbeat");
          }, options.telegramStatusMinutes * 60_000)
        : null;

    io.writeStdout(
      `${pc.bold("alea polymarket:price-sample")}  ` +
        `${pc.dim("assets=")}${options.assets.join(",")}  ` +
        `${pc.dim("timeframes=")}${options.timeframes.join(",")}  ` +
        `${pc.dim("1h_ms=")}${options.oneHourIntervalMs}  ` +
        `${pc.dim("telegram=")}${options.telegram}\n`,
    );

    try {
      await sendTelegramStatus("started");
      await runPolymarketPriceSampler({
        db,
        assets: options.assets,
        timeframes: options.timeframes,
        signal: controller.signal,
        sampleIntervalsMs: {
          "1h": options.oneHourIntervalMs,
        },
        log: (event) => {
          updateStats({ stats, event });
          io.writeStdout(`${formatLog(event)}\n`);
          if (event.kind === "error") {
            const nowMs = Date.now();
            if (nowMs >= nextTelegramErrorStatusAtMs) {
              nextTelegramErrorStatusAtMs = nowMs + errorTelegramThrottleMs;
              void sendTelegramStatus(`error: ${event.message}`);
            }
          }
        },
      });
    } finally {
      if (telegramTimer !== null) {
        clearInterval(telegramTimer);
      }
      await sendTelegramStatus("stopped");
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
      await destroyDatabase(db);
    }
  },
});

function createTelegramStatusSender({
  enabled,
  io,
  stats,
  assets,
  timeframes,
}: {
  readonly enabled: boolean;
  readonly io: { readonly writeStdout: (text: string) => void };
  readonly stats: {
    readonly startedAtMs: number;
    readonly persistedMarkets: number;
    readonly persistedSamples: number;
    readonly missingSamples: number;
    readonly lastPersistedMarket: PersistedMarket | null;
  };
  readonly assets: readonly string[];
  readonly timeframes: readonly string[];
}): (reason: string) => Promise<void> {
  if (!enabled) {
    return async () => {};
  }
  const botToken = env.telegramBotToken;
  const chatId = env.telegramChatId;
  if (!botToken) {
    throw new Error("TELEGRAM_BOT_TOKEN is not set in the environment.");
  }
  if (!chatId) {
    throw new Error("TELEGRAM_CHAT_ID is not set in the environment.");
  }

  return async (reason: string): Promise<void> => {
    const text = formatTelegramStatus({ reason, stats, assets, timeframes });
    try {
      await sendTelegramMessage({ botToken, chatId, text });
    } catch (error) {
      io.writeStdout(
        `${pc.yellow("telegram status failed:")} ${(error as Error).message}\n`,
      );
    }
  };
}

function updateStats({
  stats,
  event,
}: {
  readonly stats: {
    persistedMarkets: number;
    persistedSamples: number;
    missingSamples: number;
    lastPersistedMarket: PersistedMarket | null;
  };
  readonly event: PriceSamplerLogEvent;
}): void {
  if (event.persistedMarket === undefined) {
    return;
  }
  stats.persistedMarkets += 1;
  stats.persistedSamples += event.persistedMarket.sampleCount;
  stats.missingSamples += event.persistedMarket.missingSampleCount;
  stats.lastPersistedMarket = event.persistedMarket;
}

function formatLog(event: PriceSamplerLogEvent): string {
  const ts = new Date(event.atMs).toISOString().slice(11, 19);
  const tag =
    event.kind === "error"
      ? pc.red("ERR")
      : event.kind === "warn"
        ? pc.yellow("WRN")
        : pc.dim("INF");
  return `${pc.dim(ts)} ${tag} ${event.message}`;
}

function formatTelegramStatus({
  reason,
  stats,
  assets,
  timeframes,
}: {
  readonly reason: string;
  readonly stats: {
    readonly startedAtMs: number;
    readonly persistedMarkets: number;
    readonly persistedSamples: number;
    readonly missingSamples: number;
    readonly lastPersistedMarket: PersistedMarket | null;
  };
  readonly assets: readonly string[];
  readonly timeframes: readonly string[];
}): string {
  const uptimeMs = Date.now() - stats.startedAtMs;
  const last = stats.lastPersistedMarket;
  const lastText =
    last === null
      ? "none yet"
      : `${last.asset.toUpperCase()} ${last.timeframe} ${new Date(last.windowStartTsMs).toISOString()} samples=${last.sampleCount} missing=${last.missingSampleCount}`;
  return [
    `Alea price sampler: ${reason}`,
    `assets=${assets.join(",")} timeframes=${timeframes.join(",")}`,
    `uptime=${formatDuration(uptimeMs)} markets=${stats.persistedMarkets} samples=${stats.persistedSamples} missing=${stats.missingSamples}`,
    `last=${lastText}`,
  ].join("\n");
}

function formatDuration(ms: number): string {
  if (ms < 60_000) {
    return `${Math.max(0, Math.floor(ms / 1000))}s`;
  }
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  if (minutes < 60) {
    return `${minutes}m${String(seconds).padStart(2, "0")}s`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h${String(minutes % 60).padStart(2, "0")}m`;
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
