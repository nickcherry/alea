import { env } from "@alea/constants/env";
import type { TradeDecisionPeriod } from "@alea/constants/tradeDecision";
import { resolutionTimeframeStepMs } from "@alea/lib/polymarket/enumerateWindowStarts";
import { sendTelegramPhoto } from "@alea/lib/telegram/sendTelegramPhoto";
import type { LiveTradingOrderLogEvent } from "@alea/lib/trading/liveOrderExecution";
import type { Asset } from "@alea/types/assets";

type PendingLiveDecisionNotification = {
  readonly asset: Asset;
  readonly period: TradeDecisionPeriod;
  readonly targetTsMs: number;
  readonly prediction: "u" | "d";
  readonly imagePath: string;
  readonly reasoning: string | null;
};

type TelegramConfig = {
  readonly botToken: string;
  readonly chatId: string;
};

type SendPhoto = typeof sendTelegramPhoto;

export function createLiveDecisionTelegramNotifier({
  log,
  sendPhoto = sendTelegramPhoto,
  getConfig = telegramConfigFromEnv,
}: {
  readonly log: (event: {
    readonly kind: "error";
    readonly message: string;
  }) => void;
  readonly sendPhoto?: SendPhoto;
  readonly getConfig?: () => TelegramConfig | null;
}): {
  readonly trackDecision: (decision: PendingLiveDecisionNotification) => void;
  readonly handleOrderEvent: (event: LiveTradingOrderLogEvent) => Promise<void>;
} {
  const pending = new Map<string, PendingLiveDecisionNotification>();

  return {
    trackDecision(decision): void {
      pending.set(decisionKey(decision), decision);
    },
    async handleOrderEvent(event): Promise<void> {
      const key = decisionKey(event);
      const decision = pending.get(key);
      if (decision === undefined) {
        return;
      }
      if (event.status !== "placed") {
        if (isTerminalOrderStatus(event.status)) {
          pending.delete(key);
        }
        return;
      }
      pending.delete(key);
      const config = getConfig();
      if (config === null) {
        log({
          kind: "error",
          message:
            "live decision Telegram skipped: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is missing",
        });
        return;
      }
      try {
        await sendPhoto({
          botToken: config.botToken,
          chatId: config.chatId,
          photoPath: decision.imagePath,
          caption: formatLiveDecisionTelegramCaption(decision),
          format: "html",
        });
      } catch (error) {
        log({
          kind: "error",
          message: `live decision Telegram failed ${decision.period}/${decision.asset}: ${String(error)}`,
        });
      }
    },
  };
}

export function formatLiveDecisionTelegramCaption({
  asset,
  period,
  targetTsMs,
  prediction,
  reasoning,
}: PendingLiveDecisionNotification): string {
  const header = `<b>${escapeHtml(asset.toUpperCase())} ${escapeHtml(
    formatTimeWindowEt({ period, targetTsMs }),
  )}</b>`;
  const direction = prediction === "u" ? "UP" : "DOWN";
  const reason = escapeHtml(reasoning?.trim() ?? "No reasoning returned.");
  const fixed = `${header}\n\n<b>${direction}</b>\n`;
  const maxCaptionLength = 1_024;
  const maxReasonLength = maxCaptionLength - fixed.length;
  return `${fixed}${truncate({ text: reason, maxLength: maxReasonLength })}`;
}

function telegramConfigFromEnv(): TelegramConfig | null {
  const botToken = env.telegramBotToken;
  const chatId = env.telegramChatId;
  if (botToken === undefined || chatId === undefined) {
    return null;
  }
  return { botToken, chatId };
}

function isTerminalOrderStatus(status: LiveTradingOrderLogEvent["status"]) {
  return (
    status === "placed" ||
    status === "skipped_no_market" ||
    status === "skipped_no_price" ||
    status === "skipped_price_window" ||
    status === "skipped_confidence" ||
    status === "rejected"
  );
}

function decisionKey({
  asset,
  period,
  tsMs,
  targetTsMs,
}: {
  readonly asset: Asset;
  readonly period: TradeDecisionPeriod;
  readonly tsMs?: number;
  readonly targetTsMs?: number;
}): string {
  return `${period}:${asset}:${targetTsMs ?? tsMs}`;
}

function formatTimeWindowEt({
  period,
  targetTsMs,
}: {
  readonly period: TradeDecisionPeriod;
  readonly targetTsMs: number;
}): string {
  const endTsMs = targetTsMs + resolutionTimeframeStepMs({ timeframe: period });
  const start = timePartsEt(new Date(targetTsMs));
  const end = timePartsEt(new Date(endTsMs));
  const suffix =
    start.dayPeriod === end.dayPeriod
      ? ` ${start.dayPeriod} ET`
      : ` ${start.dayPeriod}-${end.dayPeriod} ET`;
  return `${start.hour}:${start.minute}-${end.hour}:${end.minute}${suffix}`;
}

function timePartsEt(date: Date): {
  readonly hour: string;
  readonly minute: string;
  readonly dayPeriod: string;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);
  return {
    hour: partValue({ parts, type: "hour" }),
    minute: partValue({ parts, type: "minute" }),
    dayPeriod: partValue({ parts, type: "dayPeriod" }).toUpperCase(),
  };
}

function partValue({
  parts,
  type,
}: {
  readonly parts: readonly Intl.DateTimeFormatPart[];
  readonly type: Intl.DateTimeFormatPartTypes;
}): string {
  return parts.find((part) => part.type === type)?.value ?? "";
}

function truncate({
  text,
  maxLength,
}: {
  readonly text: string;
  readonly maxLength: number;
}): string {
  if (maxLength <= 0) {
    return "";
  }
  if (text.length <= maxLength) {
    return text;
  }
  if (maxLength <= 3) {
    return ".".repeat(maxLength);
  }
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
