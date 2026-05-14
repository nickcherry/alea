import { isUsableTrainingCache } from "@alea/lib/backtest/runBacktest";
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
