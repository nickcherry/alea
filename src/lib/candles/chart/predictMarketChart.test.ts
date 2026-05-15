import {
  chartPredictionPrompt,
  chartPredictionSchema,
  imageMimeTypeForPath,
  sampleChartPredictionResponse,
} from "@alea/lib/candles/chart/predictMarketChart";
import { describe, expect, it } from "bun:test";

describe("predictMarketChart helpers", () => {
  it("maps supported chart image extensions to data-url MIME types", () => {
    expect(imageMimeTypeForPath({ imagePath: "chart.png" })).toBe("image/png");
    expect(imageMimeTypeForPath({ imagePath: "chart.JPG" })).toBe("image/jpeg");
    expect(imageMimeTypeForPath({ imagePath: "chart.webp" })).toBe(
      "image/webp",
    );
  });

  it("rejects unsupported image extensions", () => {
    expect(() => imageMimeTypeForPath({ imagePath: "chart.svg" })).toThrow(
      "unsupported chart image type",
    );
  });

  it("prompts for a fixed next-candle prediction response shape", () => {
    const prompt = chartPredictionPrompt();

    expect(prompt).toContain(
      "Predict whether the next candle will be green or red.",
    );
    expect(prompt).toContain("SMA 20");
    expect(prompt).toContain("RSI divergence marker labels");
    expect(prompt).toContain('"direction": "green"');
    expect(prompt).toContain('"reasoning"');
    expect(prompt).not.toContain("confidence");
    expect(prompt).not.toContain("Answer the user's chart question");
    expect(prompt).not.toContain("treat that as intentional anti-leak context");
  });

  it("validates the structured prediction response", () => {
    expect(chartPredictionSchema.parse(sampleChartPredictionResponse)).toEqual(
      sampleChartPredictionResponse,
    );
    expect(() =>
      chartPredictionSchema.parse({
        direction: "up",
        reasoning: "Momentum is rising.",
      }),
    ).toThrow();
    expect(() =>
      chartPredictionSchema.parse({
        direction: "red",
        reasoning: "Momentum is rolling over.",
        confidence: 0.75,
      }),
    ).toThrow();
  });
});
