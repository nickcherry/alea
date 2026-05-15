import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  OPENAI_TRADE_DECISION_CHART_HEIGHT,
  OPENAI_TRADE_DECISION_CHART_WIDTH,
  OPENAI_TRADE_DECISION_DEFAULT_MIN_CONFIDENCE,
  OPENAI_TRADE_DECISION_IMAGE_DETAIL,
} from "@alea/constants/openAiTradeDecision";
import type { TradeDecisionPeriod } from "@alea/constants/tradeDecision";
import {
  type ChartPrediction,
  predictMarketChart,
  type PredictMarketChartResult,
} from "@alea/lib/candles/chart/predictMarketChart";
import { renderMarketChartImage } from "@alea/lib/candles/chart/renderMarketChartImage";
import type { AlignedBarSeries } from "@alea/lib/filters/barSeries";
import type { FilterBar } from "@alea/lib/filters/types";
import type { Asset } from "@alea/types/assets";
import type { Candle } from "@alea/types/candles";

export type OpenAiChartTradeDecision = {
  readonly prediction: "u" | "d" | null;
  readonly direction: ChartPrediction["direction"];
  readonly confidence: number;
  readonly reasoning: string;
  readonly model: string;
  readonly minConfidence: number;
  readonly up: number;
  readonly down: number;
  readonly abstain: number;
};

type PredictChart = (params: {
  readonly imagePath: string;
  readonly detail: "low" | "high" | "auto";
}) => Promise<PredictMarketChartResult>;

type RenderChart = typeof renderMarketChartImage;

export async function evaluateOpenAiChartTradeDecision({
  asset,
  period,
  series,
  minConfidence = OPENAI_TRADE_DECISION_DEFAULT_MIN_CONFIDENCE,
  predictChart = predictMarketChart,
  renderChart = renderMarketChartImage,
}: {
  readonly asset: Asset;
  readonly period: TradeDecisionPeriod;
  readonly series: AlignedBarSeries;
  readonly minConfidence?: number;
  readonly predictChart?: PredictChart;
  readonly renderChart?: RenderChart;
}): Promise<OpenAiChartTradeDecision> {
  const tmpDir = await mkdtemp(join(tmpdir(), "alea-openai-chart-"));
  const imagePath = join(tmpDir, `${asset}-${period}.png`);
  try {
    await renderChart({
      candles: pythBarsToCandles({ asset, period, bars: series.pyth }),
      asset,
      source: "pyth",
      product: "spot",
      timeframe: period,
      outPath: imagePath,
      width: OPENAI_TRADE_DECISION_CHART_WIDTH,
      height: OPENAI_TRADE_DECISION_CHART_HEIGHT,
      showPriceLine: false,
      showTopInfo: false,
    });

    const result = await predictChart({
      imagePath,
      detail: OPENAI_TRADE_DECISION_IMAGE_DETAIL,
    });

    return chartPredictionToTradeDecision({
      chartPrediction: result.prediction,
      model: result.model,
      minConfidence,
    });
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

export function chartPredictionToTradeDecision({
  chartPrediction,
  model,
  minConfidence,
}: {
  readonly chartPrediction: ChartPrediction;
  readonly model: string;
  readonly minConfidence: number;
}): OpenAiChartTradeDecision {
  const prediction =
    chartPrediction.confidence >= minConfidence
      ? chartPrediction.direction === "green"
        ? "u"
        : "d"
      : null;
  return {
    prediction,
    direction: chartPrediction.direction,
    confidence: chartPrediction.confidence,
    reasoning: chartPrediction.reasoning,
    model,
    minConfidence,
    up: prediction === "u" ? 1 : 0,
    down: prediction === "d" ? 1 : 0,
    abstain: prediction === null ? 1 : 0,
  };
}

function pythBarsToCandles({
  asset,
  period,
  bars,
}: {
  readonly asset: Asset;
  readonly period: TradeDecisionPeriod;
  readonly bars: readonly FilterBar[];
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
