import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";

import { marketChartRecentBarsForTimeframe } from "@alea/constants/marketChart";
import {
  OPENAI_TRADE_DECISION_CHART_HEIGHT,
  OPENAI_TRADE_DECISION_CHART_WIDTH,
  OPENAI_TRADE_DECISION_IMAGE_DETAIL,
} from "@alea/constants/openAiTradeDecision";
import {
  TRADE_DECISION_INVERT_OPENAI_DIRECTION,
  type TradeDecisionPeriod,
} from "@alea/constants/tradeDecision";
import {
  type ChartPrediction,
  predictMarketChart,
  type PredictMarketChartResult,
} from "@alea/lib/candles/chart/predictMarketChart";
import { renderMarketChartImage } from "@alea/lib/candles/chart/renderMarketChartImage";
import type { AlignedMarketSeries } from "@alea/lib/marketSeries/align";
import type { MarketBar } from "@alea/lib/marketSeries/types";
import type { Asset } from "@alea/types/assets";
import type { Candle } from "@alea/types/candles";

export type ChartTradeDecision = {
  readonly prediction: "u" | "d";
  readonly openAiPrediction: "u" | "d";
  readonly invertedOpenAiDirection: boolean;
  readonly direction: ChartPrediction["direction"];
  readonly reasoning: string;
  readonly model: string;
  readonly up: number;
  readonly down: number;
  readonly abstain: number;
};

export type OpenAiChartTradeDecision = ChartTradeDecision & {
  readonly imagePath: string;
};

type PredictChart = (params: {
  readonly imagePath: string;
  readonly detail: "low" | "high" | "auto";
}) => Promise<PredictMarketChartResult>;

type RenderChart = typeof renderMarketChartImage;

export async function evaluateOpenAiChartTradeDecision({
  asset,
  period,
  targetTsMs,
  series,
  predictChart = predictMarketChart,
  renderChart = renderMarketChartImage,
}: {
  readonly asset: Asset;
  readonly period: TradeDecisionPeriod;
  readonly targetTsMs?: number;
  readonly series: AlignedMarketSeries;
  readonly predictChart?: PredictChart;
  readonly renderChart?: RenderChart;
}): Promise<OpenAiChartTradeDecision> {
  const imagePath = await createOpenAiChartImagePath({
    asset,
    period,
    targetTsMs,
  });

  await renderChart({
    candles: pythBarsToCandles({ asset, period, bars: series.pyth }).slice(
      -marketChartRecentBarsForTimeframe({ timeframe: period }),
    ),
    asset,
    source: "pyth",
    product: "spot",
    timeframe: period,
    outPath: imagePath,
    width: OPENAI_TRADE_DECISION_CHART_WIDTH,
    height: OPENAI_TRADE_DECISION_CHART_HEIGHT,
    showPriceLine: false,
    showTopInfo: false,
    showIndicators: true,
  });

  const result = await predictChart({
    imagePath,
    detail: OPENAI_TRADE_DECISION_IMAGE_DETAIL,
  });

  return {
    ...chartPredictionToTradeDecision({
      chartPrediction: result.prediction,
      model: result.model,
    }),
    imagePath,
  };
}

export function chartPredictionToTradeDecision({
  chartPrediction,
  model,
}: {
  readonly chartPrediction: ChartPrediction;
  readonly model: string;
}): ChartTradeDecision {
  const openAiPrediction =
    chartPrediction.direction === "green" ? ("u" as const) : ("d" as const);
  const prediction = TRADE_DECISION_INVERT_OPENAI_DIRECTION
    ? invertPrediction({ prediction: openAiPrediction })
    : openAiPrediction;
  return {
    prediction,
    openAiPrediction,
    invertedOpenAiDirection: TRADE_DECISION_INVERT_OPENAI_DIRECTION,
    direction: chartPrediction.direction,
    reasoning: chartPrediction.reasoning,
    model,
    up: prediction === "u" ? 1 : 0,
    down: prediction === "d" ? 1 : 0,
    abstain: 0,
  };
}

function invertPrediction({
  prediction,
}: {
  readonly prediction: "u" | "d";
}): "u" | "d" {
  return prediction === "u" ? "d" : "u";
}

function pythBarsToCandles({
  asset,
  period,
  bars,
}: {
  readonly asset: Asset;
  readonly period: TradeDecisionPeriod;
  readonly bars: readonly MarketBar[];
}): readonly Candle[] {
  return bars.map((bar) => ({
    source: "pyth",
    asset,
    product: "spot",
    timeframe: period,
    timestamp: new Date(bar.openTimeMs),
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
  }));
}

async function createOpenAiChartImagePath({
  asset,
  period,
  targetTsMs,
}: {
  readonly asset: Asset;
  readonly period: TradeDecisionPeriod;
  readonly targetTsMs: number | undefined;
}): Promise<string> {
  const dir = resolvePath("tmp", "openai-chart-decisions");
  await mkdir(dir, { recursive: true });
  const timestamp =
    targetTsMs === undefined ? new Date() : new Date(targetTsMs);
  const normalizedTimestamp = timestamp.toISOString().replace(/[:.]/g, "-");
  return resolvePath(
    dir,
    `${normalizedTimestamp}-${asset}-${period}-${randomUUID()}.png`,
  );
}
