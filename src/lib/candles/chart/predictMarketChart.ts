import { readFile } from "node:fs/promises";
import { extname } from "node:path";

import { env } from "@alea/constants/env";
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
    confidence: z
      .number()
      .min(0)
      .max(1)
      .describe("Confidence in the predicted direction, from 0 to 1."),
    reasoning: z
      .string()
      .min(1)
      .describe("Concise reasoning from the visible chart structure."),
  })
  .strict();

export type ChartPrediction = z.infer<typeof chartPredictionSchema>;

export const sampleChartPredictionResponse: ChartPrediction = {
  direction: "green",
  confidence: 0.62,
  reasoning:
    "The last visible candles are holding above a recent support shelf with modest upward closes, so continuation is slightly favored.",
};

type PredictMarketChartParams = {
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
  const client = new OpenAI({ apiKey });
  const response = await client.responses.parse({
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
            text: chartPredictionPrompt(),
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

  if (response.output_parsed === null) {
    throw new Error("OpenAI did not return a parseable chart prediction.");
  }

  return {
    prediction: chartPredictionSchema.parse(response.output_parsed),
    model: resolvedModel,
  };
}

export function chartPredictionPrompt(): string {
  return [
    "Predict whether the next candle will be green or red.",
    "Use green when the next candle is expected to close above its open; use red when it is expected to close below its open.",
    "Return confidence as a number from 0 to 1. Use values near 0.5 for weak or mixed setups, and higher values only when the visible setup is clearer.",
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
