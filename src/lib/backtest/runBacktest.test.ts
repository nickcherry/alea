import {
  isUsableTrainingCache,
  walkSeries,
} from "@alea/lib/backtest/runBacktest";
import type { AlignedBarSeries } from "@alea/lib/filters/barSeries";
import type { FilterBar } from "@alea/lib/filters/types";
import { describe, expect, it } from "bun:test";

describe("isUsableTrainingCache", () => {
  const profile = "profile-v1";
  const rangeFirstMs = Date.parse("2023-05-11T20:00:00.000Z");
  const rangeLastMs = Date.parse("2026-03-31T23:45:00.000Z");

  it("accepts an exact range/profile match", () => {
    expect(
      isUsableTrainingCache({
        existing: {
          range_first_ms: String(rangeFirstMs),
          range_last_ms: String(rangeLastMs),
          training_profile: profile,
        },
        rangeFirstMs,
        rangeLastMs,
        trainingProfileId: profile,
      }),
    ).toBe(true);
  });

  it("rejects rows that cover a newer all-DB range", () => {
    expect(
      isUsableTrainingCache({
        existing: {
          range_first_ms: String(rangeFirstMs),
          range_last_ms: String(Date.parse("2026-05-11T05:10:00.000Z")),
          training_profile: profile,
        },
        rangeFirstMs,
        rangeLastMs,
        trainingProfileId: profile,
      }),
    ).toBe(false);
  });

  it("rejects rows from a different active training profile", () => {
    expect(
      isUsableTrainingCache({
        existing: {
          range_first_ms: rangeFirstMs,
          range_last_ms: rangeLastMs,
          training_profile: "old-profile",
        },
        rangeFirstMs,
        rangeLastMs,
        trainingProfileId: profile,
      }),
    ).toBe(false);
  });
});

describe("walkSeries", () => {
  it("scores the candle after one fully hidden candle", () => {
    const series: AlignedBarSeries = {
      pyth: [
        bar(0, 100, 101),
        bar(300_000, 101, 102),
        bar(600_000, 102, 104),
        bar(900_000, 104, 100),
      ],
      coinbase: [null, null, null, null],
    };

    const walked = walkSeries({
      series,
      requiredBars: 1,
      selectWindow: (endInclusive) => [series.pyth[endInclusive]!],
      predict: (window) => (window[0]!.openTimeMs === 0 ? "up" : "down"),
    });

    expect(walked.engagements).toEqual([
      { tsMs: 600_000, direction: "u", won: 1 },
      { tsMs: 900_000, direction: "d", won: 1 },
    ]);
  });
});

function bar(openTimeMs: number, open: number, close: number): FilterBar {
  return {
    openTimeMs,
    open,
    high: Math.max(open, close),
    low: Math.min(open, close),
    close,
    volume: 0,
  };
}
