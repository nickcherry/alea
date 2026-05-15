import { computeWilderRsiSeries } from "@alea/lib/indicators/rsi";
import { describe, expect, it } from "bun:test";

describe("computeWilderRsiSeries", () => {
  it("returns null until the first period closes", () => {
    const rsi = computeWilderRsiSeries({
      closes: [1, 2, 3, 4, 5],
      period: 3,
    });

    expect(rsi.slice(0, 3)).toEqual([null, null, null]);
    expect(rsi[3]).toBe(100);
    expect(rsi[4]).toBe(100);
  });

  it("uses Wilder smoothing after the seed window", () => {
    const rsi = computeWilderRsiSeries({
      closes: [10, 12, 11, 13, 12, 14],
      period: 3,
    });

    expect(rsi[3]).toBeCloseTo(80, 8);
    expect(rsi[4]).toBeCloseTo(61.53846154, 8);
    expect(rsi[5]).toBeCloseTo(77.27272727, 8);
  });
});
