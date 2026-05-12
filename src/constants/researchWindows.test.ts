import {
  BACKTEST_WINDOW_START_MS,
  isInsideHalfOpenWindow,
  resolveBacktestWindowEndExclusiveMs,
  resolveResearchWindows,
  TRAINING_WINDOW_END_EXCLUSIVE_MS,
  TRAINING_WINDOW_END_INCLUSIVE_MS,
} from "@alea/constants/researchWindows";
import { describe, expect, it } from "bun:test";

describe("research windows", () => {
  it("ends training at Q1 2026 and starts backtesting immediately after", () => {
    expect(new Date(TRAINING_WINDOW_END_INCLUSIVE_MS).toISOString()).toBe(
      "2026-03-31T23:59:59.999Z",
    );
    expect(new Date(TRAINING_WINDOW_END_EXCLUSIVE_MS).toISOString()).toBe(
      "2026-04-01T00:00:00.000Z",
    );
    expect(BACKTEST_WINDOW_START_MS).toBe(TRAINING_WINDOW_END_EXCLUSIVE_MS);
  });

  it("resolves the backtest end as the start of today in UTC", () => {
    expect(
      new Date(
        resolveBacktestWindowEndExclusiveMs({
          nowMs: Date.parse("2026-05-12T14:30:00.000Z"),
        }),
      ).toISOString(),
    ).toBe("2026-05-12T00:00:00.000Z");
  });

  it("keeps the configured training/backtest windows non-overlapping", () => {
    const windows = resolveResearchWindows({
      trainingStartMs: Date.parse("2023-05-11T20:00:00.000Z"),
      nowMs: Date.parse("2026-05-12T14:30:00.000Z"),
    });

    expect(windows.training.endExclusiveMs).toBe(windows.backtest.startMs);
    expect(new Date(windows.backtest.endExclusiveMs).toISOString()).toBe(
      "2026-05-12T00:00:00.000Z",
    );
  });

  it("treats window ends as exclusive", () => {
    const window = {
      startMs: Date.parse("2026-04-01T00:00:00.000Z"),
      endExclusiveMs: Date.parse("2026-05-12T00:00:00.000Z"),
    };

    expect(
      isInsideHalfOpenWindow({
        tsMs: Date.parse("2026-05-11T23:59:59.999Z"),
        window,
      }),
    ).toBe(true);
    expect(
      isInsideHalfOpenWindow({
        tsMs: Date.parse("2026-05-12T00:00:00.000Z"),
        window,
      }),
    ).toBe(false);
  });
});
