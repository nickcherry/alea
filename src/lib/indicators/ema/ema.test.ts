import { computeEmaSeries } from "@alea/lib/indicators/ema";
import { describe, expect, it } from "bun:test";

describe("computeEmaSeries", () => {
  it("seeds with SMA and then applies the standard EMA smoothing factor", () => {
    expect(computeEmaSeries({ closes: [1, 2, 3, 4, 5], period: 3 })).toEqual([
      null,
      null,
      2,
      3,
      4,
    ]);
  });

  it("returns all-null warmup when there are too few closes", () => {
    expect(computeEmaSeries({ closes: [1, 2], period: 3 })).toEqual([
      null,
      null,
    ]);
  });
});

