import { trendXVol6Algo } from "@alea/lib/training/regimeAlgos/trendXVol6";
import { describe, expect, it } from "bun:test";

describe("trendXVol6Algo", () => {
  it("returns null when any input is missing", () => {
    expect(
      trendXVol6Algo.classify({
        leadingSide: "up",
        ema20: null,
        ema50: 100,
        atr14: 1,
        atr50: 1, rsi14: null, atr3: null, prev5mDirection: null, rsiDivergence5mW3: null, rsiDivergence5mW5: null, rsiDivergence5mW7: null, rsiDivergence15mW3: null, rsiDivergence15mW5: null, rsiDivergence15mW7: null,
      }),
    ).toBeNull();
    expect(
      trendXVol6Algo.classify({
        leadingSide: "up",
        ema20: 100,
        ema50: null,
        atr14: 1,
        atr50: 1, rsi14: null, atr3: null, prev5mDirection: null, rsiDivergence5mW3: null, rsiDivergence5mW5: null, rsiDivergence5mW7: null, rsiDivergence15mW3: null, rsiDivergence15mW5: null, rsiDivergence15mW7: null,
      }),
    ).toBeNull();
    expect(
      trendXVol6Algo.classify({
        leadingSide: "up",
        ema20: 100,
        ema50: 100,
        atr14: null,
        atr50: 1, rsi14: null, atr3: null, prev5mDirection: null, rsiDivergence5mW3: null, rsiDivergence5mW5: null, rsiDivergence5mW7: null, rsiDivergence15mW3: null, rsiDivergence15mW5: null, rsiDivergence15mW7: null,
      }),
    ).toBeNull();
    expect(
      trendXVol6Algo.classify({
        leadingSide: "up",
        ema20: 100,
        ema50: 100,
        atr14: 1,
        atr50: null,
        rsi14: null, atr3: null, prev5mDirection: null, rsiDivergence5mW3: null, rsiDivergence5mW5: null, rsiDivergence5mW7: null, rsiDivergence15mW3: null, rsiDivergence15mW5: null, rsiDivergence15mW7: null,
      }),
    ).toBeNull();
  });

  it("returns null when ATR is non-positive (degenerate)", () => {
    expect(
      trendXVol6Algo.classify({
        leadingSide: "up",
        ema20: 100,
        ema50: 100,
        atr14: 0,
        atr50: 1, rsi14: null, atr3: null, prev5mDirection: null, rsiDivergence5mW3: null, rsiDivergence5mW5: null, rsiDivergence5mW7: null, rsiDivergence15mW3: null, rsiDivergence15mW5: null, rsiDivergence15mW7: null,
      }),
    ).toBeNull();
    expect(
      trendXVol6Algo.classify({
        leadingSide: "up",
        ema20: 100,
        ema50: 100,
        atr14: 1,
        atr50: 0,
        rsi14: null, atr3: null, prev5mDirection: null, rsiDivergence5mW3: null, rsiDivergence5mW5: null, rsiDivergence5mW7: null, rsiDivergence15mW3: null, rsiDivergence15mW5: null, rsiDivergence15mW7: null,
      }),
    ).toBeNull();
  });

  it("classifies tiny EMA separation as no-trend regardless of leading side", () => {
    // |ema20 - ema50| / atr14 = 0.1 / 1 = 0.1 < 0.5 → no-trend
    const low = trendXVol6Algo.classify({
      leadingSide: "up",
      ema20: 100.1,
      ema50: 100,
      atr14: 1,
      atr50: 1, rsi14: null, atr3: null, prev5mDirection: null, rsiDivergence5mW3: null, rsiDivergence5mW5: null, rsiDivergence5mW7: null, rsiDivergence15mW3: null, rsiDivergence15mW5: null, rsiDivergence15mW7: null,
    });
    expect(low).toBe("no_trend_low_vol");

    const downLeading = trendXVol6Algo.classify({
      leadingSide: "down",
      ema20: 100.1,
      ema50: 100,
      atr14: 1,
      atr50: 1, rsi14: null, atr3: null, prev5mDirection: null, rsiDivergence5mW3: null, rsiDivergence5mW5: null, rsiDivergence5mW7: null, rsiDivergence15mW3: null, rsiDivergence15mW5: null, rsiDivergence15mW7: null,
    });
    expect(downLeading).toBe("no_trend_low_vol");
  });

  it("classifies upward EMA separation with up leading side as with-trend", () => {
    // (101 - 100) / 1 = 1.0 ≥ 0.5 → trending up; up leading → with-trend
    expect(
      trendXVol6Algo.classify({
        leadingSide: "up",
        ema20: 101,
        ema50: 100,
        atr14: 1,
        atr50: 1, rsi14: null, atr3: null, prev5mDirection: null, rsiDivergence5mW3: null, rsiDivergence5mW5: null, rsiDivergence5mW7: null, rsiDivergence15mW3: null, rsiDivergence15mW5: null, rsiDivergence15mW7: null,
      }),
    ).toBe("with_trend_low_vol");
  });

  it("classifies upward EMA separation with down leading side as against-trend", () => {
    expect(
      trendXVol6Algo.classify({
        leadingSide: "down",
        ema20: 101,
        ema50: 100,
        atr14: 1,
        atr50: 1, rsi14: null, atr3: null, prev5mDirection: null, rsiDivergence5mW3: null, rsiDivergence5mW5: null, rsiDivergence5mW7: null, rsiDivergence15mW3: null, rsiDivergence15mW5: null, rsiDivergence15mW7: null,
      }),
    ).toBe("against_trend_low_vol");
  });

  it("classifies downward EMA separation symmetrically (down leading = with-trend)", () => {
    // EMA20 < EMA50 → trending down. Down leading → with-trend.
    expect(
      trendXVol6Algo.classify({
        leadingSide: "down",
        ema20: 99,
        ema50: 100,
        atr14: 1,
        atr50: 1, rsi14: null, atr3: null, prev5mDirection: null, rsiDivergence5mW3: null, rsiDivergence5mW5: null, rsiDivergence5mW7: null, rsiDivergence15mW3: null, rsiDivergence15mW5: null, rsiDivergence15mW7: null,
      }),
    ).toBe("with_trend_low_vol");
    expect(
      trendXVol6Algo.classify({
        leadingSide: "up",
        ema20: 99,
        ema50: 100,
        atr14: 1,
        atr50: 1, rsi14: null, atr3: null, prev5mDirection: null, rsiDivergence5mW3: null, rsiDivergence5mW5: null, rsiDivergence5mW7: null, rsiDivergence15mW3: null, rsiDivergence15mW5: null, rsiDivergence15mW7: null,
      }),
    ).toBe("against_trend_low_vol");
  });

  it("classifies high vol when atr14 / atr50 > 1.0", () => {
    expect(
      trendXVol6Algo.classify({
        leadingSide: "up",
        ema20: 101,
        ema50: 100,
        atr14: 2,
        atr50: 1, rsi14: null, atr3: null, prev5mDirection: null, rsiDivergence5mW3: null, rsiDivergence5mW5: null, rsiDivergence5mW7: null, rsiDivergence15mW3: null, rsiDivergence15mW5: null, rsiDivergence15mW7: null,
      }),
    ).toBe("with_trend_high_vol");
    expect(
      trendXVol6Algo.classify({
        leadingSide: "up",
        ema20: 100.1,
        ema50: 100,
        atr14: 2,
        atr50: 1, rsi14: null, atr3: null, prev5mDirection: null, rsiDivergence5mW3: null, rsiDivergence5mW5: null, rsiDivergence5mW7: null, rsiDivergence15mW3: null, rsiDivergence15mW5: null, rsiDivergence15mW7: null,
      }),
    ).toBe("no_trend_high_vol");
  });

  it("classifies the exact-band edge as no-trend (strict <)", () => {
    // trendStrength = exactly 0.5 → not strictly less than 0.5 → trending
    const onBand = trendXVol6Algo.classify({
      leadingSide: "up",
      ema20: 100.5,
      ema50: 100,
      atr14: 1,
      atr50: 1, rsi14: null, atr3: null, prev5mDirection: null, rsiDivergence5mW3: null, rsiDivergence5mW5: null, rsiDivergence5mW7: null, rsiDivergence15mW3: null, rsiDivergence15mW5: null, rsiDivergence15mW7: null,
    });
    expect(onBand).toBe("with_trend_low_vol");
    // Just under the band → no-trend
    const justBelow = trendXVol6Algo.classify({
      leadingSide: "up",
      ema20: 100.4999,
      ema50: 100,
      atr14: 1,
      atr50: 1, rsi14: null, atr3: null, prev5mDirection: null, rsiDivergence5mW3: null, rsiDivergence5mW5: null, rsiDivergence5mW7: null, rsiDivergence15mW3: null, rsiDivergence15mW5: null, rsiDivergence15mW7: null,
    });
    expect(justBelow).toBe("no_trend_low_vol");
  });

  it("declares all regime labels in the canonical 6-element set", () => {
    expect([...trendXVol6Algo.regimes].sort()).toEqual(
      [
        "against_trend_high_vol",
        "against_trend_low_vol",
        "no_trend_high_vol",
        "no_trend_low_vol",
        "with_trend_high_vol",
        "with_trend_low_vol",
      ].sort(),
    );
  });

  it("never emits a label outside its declared regimes", () => {
    const declared = new Set(trendXVol6Algo.regimes);
    const samples = [
      { leadingSide: "up" as const, ema20: 101, ema50: 100, atr14: 1, atr50: 1, rsi14: null, atr3: null, prev5mDirection: null, rsiDivergence5mW3: null, rsiDivergence5mW5: null, rsiDivergence5mW7: null, rsiDivergence15mW3: null, rsiDivergence15mW5: null, rsiDivergence15mW7: null },
      { leadingSide: "up" as const, ema20: 99, ema50: 100, atr14: 1, atr50: 1, rsi14: null, atr3: null, prev5mDirection: null, rsiDivergence5mW3: null, rsiDivergence5mW5: null, rsiDivergence5mW7: null, rsiDivergence15mW3: null, rsiDivergence15mW5: null, rsiDivergence15mW7: null },
      { leadingSide: "down" as const, ema20: 101, ema50: 100, atr14: 1, atr50: 1, rsi14: null, atr3: null, prev5mDirection: null, rsiDivergence5mW3: null, rsiDivergence5mW5: null, rsiDivergence5mW7: null, rsiDivergence15mW3: null, rsiDivergence15mW5: null, rsiDivergence15mW7: null },
      { leadingSide: "down" as const, ema20: 99, ema50: 100, atr14: 1, atr50: 1, rsi14: null, atr3: null, prev5mDirection: null, rsiDivergence5mW3: null, rsiDivergence5mW5: null, rsiDivergence5mW7: null, rsiDivergence15mW3: null, rsiDivergence15mW5: null, rsiDivergence15mW7: null },
      { leadingSide: "up" as const, ema20: 100, ema50: 100, atr14: 1, atr50: 1, rsi14: null, atr3: null, prev5mDirection: null, rsiDivergence5mW3: null, rsiDivergence5mW5: null, rsiDivergence5mW7: null, rsiDivergence15mW3: null, rsiDivergence15mW5: null, rsiDivergence15mW7: null },
      { leadingSide: "up" as const, ema20: 101, ema50: 100, atr14: 2, atr50: 1, rsi14: null, atr3: null, prev5mDirection: null, rsiDivergence5mW3: null, rsiDivergence5mW5: null, rsiDivergence5mW7: null, rsiDivergence15mW3: null, rsiDivergence15mW5: null, rsiDivergence15mW7: null },
      { leadingSide: "down" as const, ema20: 99, ema50: 100, atr14: 5, atr50: 1, rsi14: null, atr3: null, prev5mDirection: null, rsiDivergence5mW3: null, rsiDivergence5mW5: null, rsiDivergence5mW7: null, rsiDivergence15mW3: null, rsiDivergence15mW5: null, rsiDivergence15mW7: null },
    ];
    for (const input of samples) {
      const label = trendXVol6Algo.classify(input);
      expect(label).not.toBeNull();
      expect(declared.has(label as string)).toBe(true);
    }
  });
});
