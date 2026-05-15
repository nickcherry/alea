import { resolve as resolvePath } from "node:path";

import {
  defaultOpenAiChartModel,
  predictMarketChart,
} from "@alea/lib/candles/chart/predictMarketChart";
import { defineCommand } from "@alea/lib/cli/defineCommand";
import { definePositional } from "@alea/lib/cli/definePositional";
import { defineValueOption } from "@alea/lib/cli/defineValueOption";
import pc from "picocolors";
import { z } from "zod";

const chartImageDetailValues = ["high", "auto", "low"] as const;

export const predictChartCommand = defineCommand({
  name: "predict:chart",
  summary: "Ask OpenAI to predict the next candle from a chart image",
  description:
    "Reads a rendered chart image and sends it to OpenAI's Responses API for a Zod-validated next-candle green/red prediction. Requires OPENAI_API_KEY.",
  positionals: [
    definePositional({
      key: "imagePath",
      valueName: "IMAGE_PATH",
      schema: z.string().min(1).describe("Path to a PNG/JPG/WEBP/GIF chart."),
    }),
  ],
  options: [
    defineValueOption({
      key: "model",
      long: "--model",
      valueName: "MODEL",
      schema: z
        .string()
        .min(1)
        .optional()
        .describe(
          `OpenAI model to use. Defaults to OPENAI_CHART_MODEL or ${defaultOpenAiChartModel}.`,
        ),
    }),
    defineValueOption({
      key: "detail",
      long: "--detail",
      valueName: "LEVEL",
      choices: chartImageDetailValues,
      schema: z
        .enum(chartImageDetailValues)
        .default("high")
        .describe("Image detail level sent to OpenAI."),
    }),
  ],
  examples: [
    "bun alea predict:chart tmp/charts/btc-pyth-5m.png",
    "bun alea predict:chart tmp/charts/btc-pyth-5m.png --detail auto",
  ],
  output:
    "Prints the model name, predicted next-candle direction, and reasoning.",
  sideEffects:
    "Reads the local image and calls the OpenAI Responses API. Does not write files or mutate trading state.",
  async run({ io, positionals, options }) {
    const imagePath = resolvePath(positionals.imagePath);
    const result = await predictMarketChart({
      imagePath,
      model: options.model,
      detail: options.detail,
    });
    const { prediction } = result;

    io.writeStdout(`${pc.bold("model")} ${pc.cyan(result.model)}\n\n`);
    io.writeStdout(
      [
        `${pc.bold("direction")} ${prediction.direction}`,
        "",
        `${pc.bold("reasoning")}`,
        prediction.reasoning,
      ].join("\n"),
    );
    io.writeStdout("\n");
  },
});
