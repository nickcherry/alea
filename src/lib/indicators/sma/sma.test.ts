import { computeSmaSeries } from "@alea/lib/indicators/sma";
import { describe, expect, it } from "bun:test";

describe("computeSmaSeries", () => {
  it("computes a rolling simple average with null warmup slots", () => {
    expect(computeSmaSeries({ closes: [1, 2, 3, 4], period: 2 })).toEqual([
      null,
      1.5,
      2.5,
      3.5,
    ]);
  });

  it("rejects non-positive periods", () => {
    expect(() => computeSmaSeries({ closes: [1, 2], period: 0 })).toThrow(
      "sma period must be a positive integer",
    );
  });
});
