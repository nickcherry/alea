import type { FilterBar } from "@alea/lib/filters/types";
import {
  chartPredictionToTradeDecision,
  evaluateOpenAiChartTradeDecision,
} from "@alea/lib/tradeDecision/openAiChartDecision";
import { describe, expect, it } from "bun:test";

describe("chartPredictionToTradeDecision", () => {
  it("turns a confident green chart prediction into UP", () => {
    expect(
      chartPredictionToTradeDecision({
        chartPrediction: {
          direction: "green",
          confidence: 0.72,
          reasoning: "Continuation is favored.",
        },
        model: "gpt-5.4",
        minConfidence: 0.7,
      }),
    ).toEqual({
      prediction: "u",
      direction: "green",
      confidence: 0.72,
      reasoning: "Continuation is favored.",
      model: "gpt-5.4",
      minConfidence: 0.7,
      up: 1,
      down: 0,
      abstain: 0,
    });
  });

  it("turns a confident red chart prediction into DOWN", () => {
    expect(
      chartPredictionToTradeDecision({
        chartPrediction: {
          direction: "red",
          confidence: 0.81,
          reasoning: "Rejection is favored.",
        },
        model: "gpt-5.4",
        minConfidence: 0.7,
      }).prediction,
    ).toBe("d");
  });

  it("abstains when OpenAI confidence is below threshold", () => {
    expect(
      chartPredictionToTradeDecision({
        chartPrediction: {
          direction: "green",
          confidence: 0.69,
          reasoning: "Mixed setup.",
        },
        model: "gpt-5.4",
        minConfidence: 0.7,
      }),
    ).toMatchObject({
      prediction: null,
      confidence: 0.69,
      minConfidence: 0.7,
      up: 0,
      down: 0,
      abstain: 1,
    });
  });

  it("renders the visible Pyth chart before asking OpenAI", async () => {
    let rendered: RenderedChartParams | null = null;

    const decision = await evaluateOpenAiChartTradeDecision({
      asset: "btc",
      period: "5m",
      series: {
        pyth: [bar({ i: 0 }), bar({ i: 1 })],
        coinbase: [null, null],
      },
      minConfidence: 0.8,
      renderChart: async (params) => {
        rendered = {
          source: params.source,
          product: params.product,
          timeframe: params.timeframe,
          showPriceLine: params.showPriceLine,
          showTopInfo: params.showTopInfo,
          candleCount: params.candles.length,
        };
        return {
          outPath: params.outPath,
          candleCount: params.candles.length,
          start: params.candles[0]!.timestamp,
          end: params.candles[params.candles.length - 1]!.timestamp,
        };
      },
      predictChart: async ({ detail }) => {
        expect(detail).toBe("high");
        return {
          model: "gpt-5.4",
          prediction: {
            direction: "red",
            confidence: 0.82,
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
    expect(renderedChart.candleCount).toBe(2);
  });
});

type RenderedChartParams = {
  readonly source: string;
  readonly product: string;
  readonly timeframe: string;
  readonly showPriceLine: boolean | undefined;
  readonly showTopInfo: boolean | undefined;
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

function bar({ i }: { readonly i: number }): FilterBar {
  return {
    openTimeMs: i * 5 * 60 * 1000,
    open: 100 + i,
    high: 101 + i,
    low: 99 + i,
    close: 100.5 + i,
    volume: 0,
  };
}
