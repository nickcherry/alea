import { resolve as resolvePath } from "node:path";

import type { TradeDecisionPeriod } from "@alea/constants/tradeDecision";
import type { MarketBar } from "@alea/lib/marketSeries/types";
import {
  chartPredictionToTradeDecision,
  evaluateOpenAiChartTradeDecision,
} from "@alea/lib/tradeDecision/openAiChartDecision";
import { describe, expect, it } from "bun:test";

describe("chartPredictionToTradeDecision", () => {
  it("turns a green chart prediction into UP", () => {
    expect(
      chartPredictionToTradeDecision({
        chartPrediction: {
          direction: "green",
          reasoning: "Continuation is favored.",
        },
        model: "gpt-5.4",
      }),
    ).toEqual({
      prediction: "u",
      direction: "green",
      reasoning: "Continuation is favored.",
      model: "gpt-5.4",
      up: 1,
      down: 0,
      abstain: 0,
    });
  });

  it("turns a red chart prediction into DOWN", () => {
    expect(
      chartPredictionToTradeDecision({
        chartPrediction: {
          direction: "red",
          reasoning: "Rejection is favored.",
        },
        model: "gpt-5.4",
      }).prediction,
    ).toBe("d");
  });

  it("renders the visible Pyth chart before asking OpenAI", async () => {
    let rendered: RenderedChartParams | null = null;
    let predictedImagePath: string | null = null;
    const targetTsMs = Date.UTC(2026, 0, 2, 3, 4, 5, 6);

    const decision = await evaluateOpenAiChartTradeDecision({
      asset: "btc",
      period: "5m",
      targetTsMs,
      series: {
        pyth: [bar({ i: 0 }), bar({ i: 1 })],
        coinbase: [null, null],
      },
      renderChart: async (params) => {
        rendered = {
          source: params.source,
          product: params.product,
          timeframe: params.timeframe,
          showPriceLine: params.showPriceLine,
          showTopInfo: params.showTopInfo,
          showIndicators: params.showIndicators,
          candleCount: params.candles.length,
        };
        return {
          outPath: params.outPath,
          candleCount: params.candles.length,
          start: params.candles[0]!.timestamp,
          end: params.candles[params.candles.length - 1]!.timestamp,
        };
      },
      predictChart: async ({ detail, imagePath }) => {
        predictedImagePath = imagePath;
        expect(detail).toBe("high");
        return {
          model: "gpt-5.4",
          prediction: {
            direction: "red",
            reasoning: "The last candle rejected higher prices.",
          },
        };
      },
    });

    expect(decision.prediction).toBe("d");
    const renderedChart = requireRenderedChart(rendered);
    expect(renderedChart.source).toBe("pyth");
    expect(renderedChart.product).toBe("spot");
    expect(renderedChart.timeframe).toBe("5m");
    expect(renderedChart.showPriceLine).toBe(false);
    expect(renderedChart.showTopInfo).toBe(false);
    expect(renderedChart.showIndicators).toBe(true);
    expect(renderedChart.candleCount).toBe(2);
    const imagePath = requireString(predictedImagePath);
    expect(decision.imagePath).toBe(imagePath);
    expect(
      imagePath.startsWith(`${resolvePath("tmp", "openai-chart-decisions")}/`),
    ).toBe(true);
    expect(imagePath).toContain("2026-01-02T03-04-05-006Z-btc-5m-");
    expect(imagePath.endsWith(".png")).toBe(true);
  });

  it("trims trading charts to the period-specific lookback window", async () => {
    const cases: readonly {
      readonly period: TradeDecisionPeriod;
      readonly inputBars: number;
      readonly expectedRenderedBars: number;
    }[] = [
      { period: "5m", inputBars: 1300, expectedRenderedBars: 1152 },
      { period: "15m", inputBars: 1200, expectedRenderedBars: 960 },
    ];

    for (const testCase of cases) {
      let renderedCandleCount = 0;
      await evaluateOpenAiChartTradeDecision({
        asset: "btc",
        period: testCase.period,
        series: {
          pyth: Array.from({ length: testCase.inputBars }, (_, i) =>
            bar({ i }),
          ),
          coinbase: Array.from({ length: testCase.inputBars }, () => null),
        },
        renderChart: async (params) => {
          renderedCandleCount = params.candles.length;
          return {
            outPath: params.outPath,
            candleCount: params.candles.length,
            start: params.candles[0]!.timestamp,
            end: params.candles[params.candles.length - 1]!.timestamp,
          };
        },
        predictChart: async () => ({
          model: "gpt-5.4",
          prediction: {
            direction: "green",
            reasoning: "The visible chart supports continuation.",
          },
        }),
      });

      expect(renderedCandleCount).toBe(testCase.expectedRenderedBars);
    }
  });
});

type RenderedChartParams = {
  readonly source: string;
  readonly product: string;
  readonly timeframe: string;
  readonly showPriceLine: boolean | undefined;
  readonly showTopInfo: boolean | undefined;
  readonly showIndicators: boolean | undefined;
  readonly candleCount: number;
};

function requireRenderedChart(
  rendered: RenderedChartParams | null,
): RenderedChartParams {
  if (rendered === null) {
    throw new Error("expected chart renderer to be called");
  }
  return rendered;
}

function requireString(value: string | null): string {
  if (value === null) {
    throw new Error("expected string value");
  }
  return value;
}

function bar({ i }: { readonly i: number }): MarketBar {
  return {
    openTimeMs: i * 5 * 60 * 1000,
    open: 100 + i,
    high: 101 + i,
    low: 99 + i,
    close: 100.5 + i,
    volume: 0,
  };
}
