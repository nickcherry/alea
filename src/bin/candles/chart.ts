import { resolve as resolvePath } from "node:path";

import { assetValues } from "@alea/constants/assets";
import { candleTimeframeValues } from "@alea/constants/candles";
import { productValues } from "@alea/constants/products";
import { candleSourceValues } from "@alea/constants/sources";
import { fetchMarketChartCandles } from "@alea/lib/candles/chart/fetchMarketChartCandles";
import { renderMarketChartImage } from "@alea/lib/candles/chart/renderMarketChartImage";
import { defineCommand } from "@alea/lib/cli/defineCommand";
import { defineFlagOption } from "@alea/lib/cli/defineFlagOption";
import { defineValueOption } from "@alea/lib/cli/defineValueOption";
import { openHtmlOnDarwin } from "@alea/lib/exchangePrices/openHtmlOnDarwin";
import { assetSchema } from "@alea/types/assets";
import { candleTimeframeSchema } from "@alea/types/candles";
import { productSchema } from "@alea/types/products";
import { candleSourceSchema } from "@alea/types/sources";
import pc from "picocolors";
import { z } from "zod";

const defaultBars = 288;
const defaultWidth = 1600;
const defaultHeight = 900;

export const candlesChartCommand = defineCommand({
  name: "candles:chart",
  summary: "Render a market candle chart PNG",
  description:
    "Fetches candles from the selected source and renders a TradingView Lightweight Charts candlestick + volume PNG. Defaults to a recent Coinbase BTC-USD 5m spot chart; pass --start/--end for an explicit range.",
  options: [
    defineValueOption({
      key: "asset",
      long: "--asset",
      short: "-a",
      valueName: "ASSET",
      choices: assetValues,
      schema: assetSchema.default("btc").describe("Asset to chart."),
    }),
    defineValueOption({
      key: "timeframe",
      long: "--timeframe",
      short: "-t",
      valueName: "TIMEFRAME",
      choices: candleTimeframeValues,
      schema: candleTimeframeSchema
        .default("5m")
        .describe("Candle timeframe to render."),
    }),
    defineValueOption({
      key: "source",
      long: "--source",
      short: "-s",
      valueName: "SOURCE",
      choices: candleSourceValues,
      schema: candleSourceSchema
        .default("coinbase")
        .describe("Candle source to fetch from."),
    }),
    defineValueOption({
      key: "product",
      long: "--product",
      short: "-p",
      valueName: "PRODUCT",
      choices: productValues,
      schema: productSchema.default("spot").describe("Spot or perp market."),
    }),
    defineValueOption({
      key: "bars",
      long: "--bars",
      valueName: "N",
      schema: z.coerce
        .number()
        .int()
        .min(20)
        .max(2000)
        .default(defaultBars)
        .describe(
          "Number of recent completed candles to render when --start is omitted.",
        ),
    }),
    defineValueOption({
      key: "start",
      long: "--start",
      valueName: "ISO",
      schema: optionalDateSchema(
        "Optional chart window start time. Floored to the timeframe boundary; when set, renders the full start/end range.",
      ),
    }),
    defineValueOption({
      key: "end",
      long: "--end",
      valueName: "ISO",
      schema: optionalDateSchema(
        "Optional chart window end time. Floored to the timeframe boundary.",
      ),
    }),
    defineValueOption({
      key: "out",
      long: "--out",
      short: "-o",
      valueName: "PATH",
      schema: z
        .string()
        .optional()
        .describe("PNG output path. Defaults to tmp/charts/...png."),
    }),
    defineValueOption({
      key: "width",
      long: "--width",
      valueName: "PX",
      schema: z.coerce
        .number()
        .int()
        .min(640)
        .max(3840)
        .default(defaultWidth)
        .describe("Output image width in pixels."),
    }),
    defineValueOption({
      key: "height",
      long: "--height",
      valueName: "PX",
      schema: z.coerce
        .number()
        .int()
        .min(420)
        .max(2160)
        .default(defaultHeight)
        .describe("Output image height in pixels."),
    }),
    defineValueOption({
      key: "browserPath",
      long: "--browser-path",
      valueName: "PATH",
      schema: z
        .string()
        .optional()
        .describe(
          "Optional Chrome/Chromium executable path. Also accepts ALEA_CHART_BROWSER_PATH.",
        ),
    }),
    defineFlagOption({
      key: "noPriceLine",
      long: "--no-price-line",
      schema: z
        .boolean()
        .default(false)
        .describe(
          "Hide the latest-price horizontal line and last-value label.",
        ),
    }),
    defineFlagOption({
      key: "noTopInfo",
      long: "--no-top-info",
      schema: z
        .boolean()
        .default(false)
        .describe("Hide the top OHLC/change/range information block."),
    }),
    defineFlagOption({
      key: "noOpen",
      long: "--no-open",
      schema: z
        .boolean()
        .default(false)
        .describe("Skip opening the rendered PNG on macOS."),
    }),
  ],
  examples: [
    "bun alea candles:chart",
    "bun alea candles:chart --asset btc --timeframe 5m",
    "bun alea candles:chart --asset eth --timeframe 15m --source coinbase --bars 192",
    "bun alea candles:chart --asset btc --timeframe 5m --start 2026-05-15T09:30:00Z --end 2026-05-15T13:30:00Z",
    "bun alea candles:chart --asset btc --timeframe 5m --no-price-line --no-top-info",
    "bun alea candles:chart --source pyth --asset sol --out tmp/charts/sol-pyth.png --no-open",
  ],
  output: "Prints the rendered PNG path and candle window.",
  sideEffects:
    "Hits the configured candle source API, writes one PNG file, and opens it on macOS unless --no-open is set.",
  async run({ io, options }) {
    const outPath = resolvePath(
      options.out ??
        `tmp/charts/${options.source}-${options.product}-${options.asset}-${options.timeframe}-${timestampForFilename(new Date())}.png`,
    );

    io.writeStdout(
      `${pc.bold("alea candles:chart")} ${pc.cyan(`${options.source}/${options.product}/${options.asset}/${options.timeframe}`)} ${pc.dim(chartWindowLabel({ start: options.start, end: options.end, bars: options.bars }))}\n`,
    );

    const candles = await fetchMarketChartCandles({
      source: options.source,
      asset: options.asset,
      product: options.product,
      timeframe: options.timeframe,
      bars: options.bars,
      start: options.start,
      end: options.end,
    });

    const result = await renderMarketChartImage({
      candles,
      asset: options.asset,
      source: options.source,
      product: options.product,
      timeframe: options.timeframe,
      outPath,
      width: options.width,
      height: options.height,
      browserPath: options.browserPath,
      showPriceLine: !options.noPriceLine,
      showTopInfo: !options.noTopInfo,
    });

    io.writeStdout(
      `${pc.green("wrote")} ${pc.dim(result.outPath)}  ${pc.dim("candles=")}${result.candleCount.toLocaleString()}  ${pc.dim("window=")}${result.start.toISOString()} → ${result.end.toISOString()}\n`,
    );

    if (!options.noOpen) {
      openHtmlOnDarwin({ path: result.outPath });
    }
  },
});

function timestampForFilename(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

function optionalDateSchema(description: string) {
  return z
    .string()
    .optional()
    .transform((value) => (value === undefined ? undefined : new Date(value)))
    .refine(
      (value) => value === undefined || Number.isFinite(value.getTime()),
      "must be a valid date/time",
    )
    .describe(description);
}

function chartWindowLabel({
  start,
  end,
  bars,
}: {
  readonly start: Date | undefined;
  readonly end: Date | undefined;
  readonly bars: number;
}): string {
  if (start !== undefined) {
    const endLabel = end === undefined ? "now" : end.toISOString();
    return `range=${start.toISOString()}..${endLabel}`;
  }
  return `bars=${bars}`;
}
