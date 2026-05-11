import {
  resolveTrainingOutcomeDirection,
  type TrainingOutcomeDirection,
} from "@alea/lib/training/resolveTrainingOutcomeDirection";
import { describe, expect, it } from "bun:test";

describe("resolveTrainingOutcomeDirection", () => {
  it("labels moves only when they exceed the configured percent band", () => {
    const resolve = (close: number): TrainingOutcomeDirection | null =>
      resolveTrainingOutcomeDirection({
        open: 100,
        close,
        minAbsMovePct: 1,
      });

    expect(resolve(101.01)).toBe("up");
    expect(resolve(98.99)).toBe("down");
    expect(resolve(101)).toBeNull();
    expect(resolve(99)).toBeNull();
    expect(resolve(100)).toBeNull();
  });

  it("rejects invalid candle prices and thresholds", () => {
    expect(() =>
      resolveTrainingOutcomeDirection({ open: 0, close: 100 }),
    ).toThrow("positive finite open");
    expect(() =>
      resolveTrainingOutcomeDirection({ open: 100, close: Number.NaN }),
    ).toThrow("finite close");
    expect(() =>
      resolveTrainingOutcomeDirection({
        open: 100,
        close: 101,
        minAbsMovePct: -1,
      }),
    ).toThrow("non-negative");
  });
});
