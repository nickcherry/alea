import { access, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { env } from "@alea/constants/env";
import type { Asset } from "@alea/types/assets";
import type { Candle, CandleTimeframe } from "@alea/types/candles";
import type { Product } from "@alea/types/products";
import type { CandleSource } from "@alea/types/sources";
import { chromium } from "playwright-core";

type RenderMarketChartImageParams = {
  readonly candles: readonly Candle[];
  readonly asset: Asset;
  readonly source: CandleSource;
  readonly product: Product;
  readonly timeframe: CandleTimeframe;
  readonly outPath: string;
  readonly width: number;
  readonly height: number;
  readonly browserPath?: string;
  readonly showPriceLine?: boolean;
  readonly showTopInfo?: boolean;
};

export type RenderMarketChartImageResult = {
  readonly outPath: string;
  readonly candleCount: number;
  readonly start: Date;
  readonly end: Date;
};

type MarketChartPayload = {
  readonly title: string;
  readonly subtitle: string;
  readonly latestLabel: string;
  readonly rangeLabel: string;
  readonly width: number;
  readonly height: number;
  readonly showPriceLine: boolean;
  readonly showTopInfo: boolean;
  readonly candles: readonly LightweightCandlestick[];
  readonly volume: readonly LightweightVolumeBar[];
};

type LightweightCandlestick = {
  readonly time: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
};

type LightweightVolumeBar = {
  readonly time: number;
  readonly value: number;
  readonly color: string;
};

const upColor = "#16a085";
const downColor = "#e04f5f";
const fallbackBrowserPaths = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
] as const;

/**
 * Renders a TradingView Lightweight Charts candlestick view to a PNG image.
 * The chart is browser-rendered rather than hand-drawn so the output is close
 * to the familiar Coinbase/TradingView candle + volume surface.
 */
export async function renderMarketChartImage({
  candles,
  asset,
  source,
  product,
  timeframe,
  outPath,
  width,
  height,
  browserPath,
  showPriceLine = true,
  showTopInfo = true,
}: RenderMarketChartImageParams): Promise<RenderMarketChartImageResult> {
  if (candles.length === 0) {
    throw new Error(
      `no candles returned for ${source}/${product}/${asset}/${timeframe}`,
    );
  }

  await mkdir(dirname(outPath), { recursive: true });

  const payload = marketChartPayload({
    candles,
    asset,
    source,
    product,
    timeframe,
    width,
    height,
    showPriceLine,
    showTopInfo,
  });
  const html = await buildMarketChartHtml({ payload });
  const executablePath = await resolveBrowserPath({ browserPath });
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      ...(executablePath === undefined ? {} : { executablePath }),
    });
  } catch (error) {
    throw new Error(
      `failed to launch Chrome for chart rendering. Install Google Chrome, run Playwright's browser installer, or set ALEA_CHART_BROWSER_PATH. Original error: ${(error as Error)?.message ?? String(error)}`,
    );
  }

  try {
    const page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: 1,
    });
    await page.setContent(html, { waitUntil: "load" });
    await page.waitForFunction("window.__aleaMarketChartReady === true", null, {
      timeout: 10_000,
    });
    await page.locator("#capture").screenshot({ path: outPath });
  } finally {
    await browser.close();
  }

  return {
    outPath,
    candleCount: payload.candles.length,
    start: candles[0]!.timestamp,
    end: candles[candles.length - 1]!.timestamp,
  };
}

export function marketChartPayload({
  candles,
  asset,
  source,
  product,
  timeframe,
  width,
  height,
  showPriceLine = true,
  showTopInfo = true,
}: {
  readonly candles: readonly Candle[];
  readonly asset: Asset;
  readonly source: CandleSource;
  readonly product: Product;
  readonly timeframe: CandleTimeframe;
  readonly width: number;
  readonly height: number;
  readonly showPriceLine?: boolean;
  readonly showTopInfo?: boolean;
}): MarketChartPayload {
  const latest = candles[candles.length - 1];
  if (latest === undefined) {
    throw new Error("cannot build a chart payload without candles");
  }
  const previous = candles[candles.length - 2];
  const changePct =
    previous === undefined || previous.close === 0
      ? 0
      : ((latest.close - previous.close) / previous.close) * 100;
  const title = `${asset.toUpperCase()}-${product === "spot" ? "USD" : "PERP"} ${timeframe}`;
  const subtitle = `${displaySource(source)} ${product}`;

  return {
    title,
    subtitle,
    latestLabel:
      `O ${formatPrice(latest.open)}  H ${formatPrice(latest.high)}  ` +
      `L ${formatPrice(latest.low)}  C ${formatPrice(latest.close)}  ` +
      `${formatSignedPct(changePct)}`,
    rangeLabel: `${formatUtc(candles[0]!.timestamp)} to ${formatUtc(latest.timestamp)} UTC`,
    width,
    height,
    showPriceLine,
    showTopInfo,
    candles: candles.map((candle) => ({
      time: Math.floor(candle.timestamp.getTime() / 1000),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    })),
    volume: candles.map((candle) => ({
      time: Math.floor(candle.timestamp.getTime() / 1000),
      value: candle.volume,
      color:
        candle.close >= candle.open
          ? "rgba(22, 160, 133, 0.42)"
          : "rgba(224, 79, 95, 0.42)",
    })),
  };
}

async function buildMarketChartHtml({
  payload,
}: {
  readonly payload: MarketChartPayload;
}): Promise<string> {
  const scriptSource = await readFile(
    join(
      dirname(
        fileURLToPath(import.meta.resolve("lightweight-charts/package.json")),
      ),
      "dist",
      "lightweight-charts.standalone.production.js",
    ),
    "utf8",
  );
  const payloadJson = JSON.stringify(payload).replaceAll("</", "<\\/");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    html, body {
      margin: 0;
      width: ${payload.width}px;
      height: ${payload.height}px;
      overflow: hidden;
      background: #0b0f16;
      color: #d6dde8;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    #capture {
      width: ${payload.width}px;
      height: ${payload.height}px;
      background: #0b0f16;
      display: flex;
      flex-direction: column;
    }
    .topbar {
      height: 62px;
      box-sizing: border-box;
      padding: 13px 18px 10px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid rgba(93, 110, 132, 0.28);
      background: #111722;
    }
    .identity {
      display: flex;
      flex-direction: column;
      gap: 3px;
      min-width: 0;
    }
    .title {
      display: flex;
      align-items: baseline;
      gap: 10px;
      font-size: 18px;
      font-weight: 680;
      letter-spacing: 0;
      color: #f2f5f8;
      white-space: nowrap;
    }
    .subtitle {
      font-size: 12px;
      color: #8190a3;
      text-transform: uppercase;
      letter-spacing: .04em;
    }
    .latest {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 3px;
      min-width: 0;
      font-variant-numeric: tabular-nums;
      text-align: right;
    }
    .ohlc {
      font-size: 13px;
      color: #d6dde8;
      white-space: nowrap;
    }
    .range {
      font-size: 12px;
      color: #8190a3;
      white-space: nowrap;
    }
    #chart {
      width: ${payload.width}px;
      height: ${payload.height - 62}px;
    }
  </style>
</head>
<body>
  <div id="capture">
    <div class="topbar">
      <div class="identity">
        <div class="title"><span>${escapeHtml(payload.title)}</span></div>
        <div class="subtitle">${escapeHtml(payload.subtitle)}</div>
      </div>
      ${
        payload.showTopInfo
          ? `<div class="latest">
        <div class="ohlc">${escapeHtml(payload.latestLabel)}</div>
        <div class="range">${escapeHtml(payload.rangeLabel)}</div>
      </div>`
          : ""
      }
    </div>
    <div id="chart"></div>
  </div>
  <script>${scriptSource}</script>
  <script>
    const payload = ${payloadJson};
    const chartHost = document.getElementById("chart");
    const chart = LightweightCharts.createChart(chartHost, {
      width: payload.width,
      height: payload.height - 62,
      autoSize: false,
      layout: {
        background: { type: LightweightCharts.ColorType.Solid, color: "#0b0f16" },
        textColor: "#7f8da2",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(93, 110, 132, 0.18)" },
        horzLines: { color: "rgba(93, 110, 132, 0.18)" },
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
        vertLine: { color: "rgba(214, 221, 232, 0.28)", width: 1, style: LightweightCharts.LineStyle.Dashed },
        horzLine: { color: "rgba(214, 221, 232, 0.28)", width: 1, style: LightweightCharts.LineStyle.Dashed },
      },
      rightPriceScale: {
        borderColor: "rgba(93, 110, 132, 0.34)",
        scaleMargins: { top: 0.08, bottom: 0.24 },
      },
      timeScale: {
        borderColor: "rgba(93, 110, 132, 0.34)",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 8,
        barSpacing: Math.max(4, Math.min(11, (payload.width - 110) / payload.candles.length)),
      },
      localization: {
        priceFormatter: price => price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      },
    });

    const candleSeries = chart.addSeries(LightweightCharts.CandlestickSeries, {
      upColor: "${upColor}",
      downColor: "${downColor}",
      borderUpColor: "${upColor}",
      borderDownColor: "${downColor}",
      wickUpColor: "${upColor}",
      wickDownColor: "${downColor}",
      priceLineColor: "rgba(214, 221, 232, 0.55)",
      priceLineVisible: payload.showPriceLine,
      lastValueVisible: payload.showPriceLine,
    });
    candleSeries.setData(payload.candles);

    const volumeSeries = chart.addSeries(LightweightCharts.HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "",
      priceLineVisible: false,
      lastValueVisible: false,
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });
    volumeSeries.setData(payload.volume);

    chart.timeScale().fitContent();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.__aleaMarketChartReady = true;
      });
    });
  </script>
</body>
</html>`;
}

async function resolveBrowserPath({
  browserPath,
}: {
  readonly browserPath: string | undefined;
}): Promise<string | undefined> {
  const explicit =
    browserPath ?? env.chartBrowserPath ?? env.playwrightChromiumExecutablePath;
  if (explicit !== undefined && explicit.length > 0) {
    return explicit;
  }
  for (const candidate of fallbackBrowserPaths) {
    if (await exists(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function displaySource(source: CandleSource): string {
  switch (source) {
    case "coinbase":
      return "Coinbase";
    case "binance":
      return "Binance";
    case "coindesk":
      return "CoinDesk CADLI";
    case "pyth":
      return "Pyth";
  }
}

function formatPrice(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatSignedPct(value: number): string {
  const prefix = value >= 0 ? "+" : "";
  return `${prefix}${value.toFixed(2)}%`;
}

function formatUtc(date: Date): string {
  return date.toISOString().replace(/:\d{2}\.\d{3}Z$/, "Z");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
