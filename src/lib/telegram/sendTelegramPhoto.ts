import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import {
  telegramErrorSchema,
  telegramSendMessageSuccessSchema,
} from "@alea/types/telegram";

const telegramApiBaseUrl = "https://api.telegram.org";

type SendTelegramPhotoParams = {
  readonly botToken: string;
  readonly chatId: string;
  readonly photoPath: string;
  readonly caption?: string;
  readonly format?: "plain" | "html";
};

export type SendTelegramPhotoResult = {
  readonly messageId: number;
};

export async function sendTelegramPhoto({
  botToken,
  chatId,
  photoPath,
  caption,
  format = "plain",
}: SendTelegramPhotoParams): Promise<SendTelegramPhotoResult> {
  const bytes = await readFile(photoPath);
  const form = new FormData();
  form.append("chat_id", chatId);
  form.append(
    "photo",
    new Blob([new Uint8Array(bytes)], { type: imageMimeType({ photoPath }) }),
    basename(photoPath),
  );
  if (caption !== undefined && caption.trim().length > 0) {
    form.append("caption", caption);
    if (format === "html") {
      form.append("parse_mode", "HTML");
    }
  }

  const response = await fetch(
    `${telegramApiBaseUrl}/bot${botToken}/sendPhoto`,
    {
      method: "POST",
      body: form,
    },
  );

  const rawBody = await response.text();
  const payload = parseJsonResponse({ rawBody });

  if (!response.ok) {
    const error = telegramErrorSchema.safeParse(payload);
    const description = error.success ? error.data.description : rawBody;
    throw new Error(
      `Telegram sendPhoto failed with HTTP ${response.status}: ${description}`,
    );
  }

  const error = telegramErrorSchema.safeParse(payload);
  if (error.success) {
    throw new Error(`Telegram sendPhoto failed: ${error.data.description}`);
  }

  const success = telegramSendMessageSuccessSchema.parse(payload);
  return { messageId: success.result.message_id };
}

function imageMimeType({ photoPath }: { readonly photoPath: string }): string {
  const lower = photoPath.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (lower.endsWith(".webp")) {
    return "image/webp";
  }
  return "image/png";
}

function parseJsonResponse({ rawBody }: { readonly rawBody: string }): unknown {
  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    throw new Error("Telegram API returned a non-JSON response.");
  }
}
