import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, extname, resolve as resolvePath } from "node:path";

import { env } from "@alea/constants/env";
import { OPENAI_TRADE_DECISION_REQUEST_TIMEOUT_MS } from "@alea/constants/openAiTradeDecision";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

export const defaultOpenAiChartModel = "gpt-5.4";

const chartPredictionInstructions =
  "You are a crypto candle-direction predictor for Alea. " +
  "Your only task is to predict the color of the next candle after the final visible candle.";

export const chartPredictionSchema = z
  .object({
    direction: z
      .enum(["green", "red"])
      .describe("Predicted next-candle color."),
    reasoning: z
      .string()
      .min(1)
      .describe("Concise reasoning from the visible chart structure."),
  })
  .strict();

export type ChartPrediction = z.infer<typeof chartPredictionSchema>;

export const sampleChartPredictionResponse: ChartPrediction = {
  direction: "green",
  reasoning:
    "The last visible candles are holding above a recent support shelf with modest upward closes, so continuation is slightly favored.",
};

export type PredictMarketChartParams = {
  readonly imagePath: string;
  readonly model?: string;
  readonly detail: "low" | "high" | "auto";
};

export type PredictMarketChartResult = {
  readonly prediction: ChartPrediction;
  readonly model: string;
};

export async function predictMarketChart({
  imagePath,
  model,
  detail,
}: PredictMarketChartParams): Promise<PredictMarketChartResult> {
  const apiKey = env.openaiApiKey;
  if (apiKey === undefined) {
    throw new Error("OPENAI_API_KEY is required to predict from chart images.");
  }

  const resolvedModel =
    model ?? env.openaiChartModel ?? defaultOpenAiChartModel;
  const prompt = chartPredictionPrompt();
  const client = new OpenAI({
    apiKey,
    maxRetries: 0,
    timeout: OPENAI_TRADE_DECISION_REQUEST_TIMEOUT_MS,
  });
  const requestLog = {
    at: new Date().toISOString(),
    model: resolvedModel,
    detail,
    imagePath,
    instructions: chartPredictionInstructions,
    prompt,
  };
  let response: Awaited<ReturnType<typeof client.responses.parse>>;
  try {
    response = await client.responses.parse({
      model: resolvedModel,
      instructions: chartPredictionInstructions,
      text: {
        format: zodTextFormat(chartPredictionSchema, "chart_prediction"),
      },
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: prompt,
            },
            {
              type: "input_image",
              image_url: await imageDataUrl({ imagePath }),
              detail,
            },
          ],
        },
      ],
    });
  } catch (error) {
    await appendOpenAiChartPromptLog({
      ...requestLog,
      error: errorMessage(error),
    });
    throw error;
  }

  if (response.output_parsed === null) {
    await appendOpenAiChartPromptLog({
      ...requestLog,
      responseId: response.id,
      outputText: response.output_text,
      error: "OpenAI did not return a parseable chart prediction.",
    });
    throw new Error("OpenAI did not return a parseable chart prediction.");
  }

  const prediction = chartPredictionSchema.parse(response.output_parsed);
  await appendOpenAiChartPromptLog({
    ...requestLog,
    responseId: response.id,
    outputText: response.output_text,
    response: prediction,
  });

  return {
    prediction,
    model: resolvedModel,
  };
}

export function chartPredictionPrompt(): string {
  return [
    "Predict whether the next candle will be green or red.",
    "Use green when the next candle is expected to close above its open; use red when it is expected to close below its open.",
    "Reasoning should be concise and based on the visible candle, trend, volatility, support/resistance, and volume structure.",
    "",
    "Return exactly this JSON shape with no markdown or extra keys:",
    JSON.stringify(sampleChartPredictionResponse, null, 2),
  ].join("\n");
}

export async function imageDataUrl({
  imagePath,
}: {
  readonly imagePath: string;
}): Promise<string> {
  const bytes = await readFile(imagePath);
  return `data:${imageMimeTypeForPath({ imagePath })};base64,${bytes.toString("base64")}`;
}

export function imageMimeTypeForPath({
  imagePath,
}: {
  readonly imagePath: string;
}): string {
  switch (extname(imagePath).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    default:
      throw new Error(
        `unsupported chart image type: ${imagePath}. Use PNG, JPG, WEBP, or GIF.`,
      );
  }
}

async function appendOpenAiChartPromptLog(
  entry: Record<string, unknown>,
): Promise<void> {
  const logPath = resolvePath(env.openaiChartPromptLogPath);
  await mkdir(dirname(logPath), { recursive: true });
  await appendFile(logPath, `${JSON.stringify(entry)}\n`, "utf8");
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactSecretLikeText({ text: message });
}

function redactSecretLikeText({ text }: { readonly text: string }): string {
  return text.replace(/sk-[A-Za-z0-9_*.-]{8,}/g, "sk-[redacted]");
}
