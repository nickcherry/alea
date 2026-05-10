import { barCarry2Algo } from "@alea/lib/training/regimeAlgos/barCarry2";
import { describe, expect, it } from "bun:test";

const baseInput = {
  ema20: 100,
  ema50: 100,
  atr14: 1,
  atr50: 1,
  rsi14: null,
  atr3: null,
  rsiDivergence5mW3: null,
  rsiDivergence5mW5: null,
  rsiDivergence5mW7: null,
  rsiDivergence15mW3: null,
  rsiDivergence15mW5: null,
  rsiDivergence15mW7: null,
} as const;

describe("barCarry2Algo", () => {
  it("returns null when prev5mDirection is missing", () => {
    expect(
      barCarry2Algo.classify({
        ...baseInput,
        leadingSide: "up",
        prev5mDirection: null,
      }),
    ).toBeNull();
  });

  it("classifies aligned up sides as continuation", () => {
    expect(
      barCarry2Algo.classify({
        ...baseInput,
        leadingSide: "up",
        prev5mDirection: "up",
      }),
    ).toBe("continuation");
  });

  it("classifies aligned down sides as continuation", () => {
    expect(
      barCarry2Algo.classify({
        ...baseInput,
        leadingSide: "down",
        prev5mDirection: "down",
      }),
    ).toBe("continuation");
  });

  it("classifies up leading vs down prior as reversion", () => {
    expect(
      barCarry2Algo.classify({
        ...baseInput,
        leadingSide: "up",
        prev5mDirection: "down",
      }),
    ).toBe("reversion");
  });

  it("classifies down leading vs up prior as reversion", () => {
    expect(
      barCarry2Algo.classify({
        ...baseInput,
        leadingSide: "down",
        prev5mDirection: "up",
      }),
    ).toBe("reversion");
  });

  it("declares all regime labels in the canonical 2-element set", () => {
    expect([...barCarry2Algo.regimes].sort()).toEqual(
      ["continuation", "reversion"].sort(),
    );
  });

  it("never emits a label outside its declared regimes", () => {
    const declared = new Set(barCarry2Algo.regimes);
    const samples = [
      { leadingSide: "up" as const, prev5mDirection: "up" as const },
      { leadingSide: "up" as const, prev5mDirection: "down" as const },
      { leadingSide: "down" as const, prev5mDirection: "up" as const },
      { leadingSide: "down" as const, prev5mDirection: "down" as const },
    ];
    for (const sides of samples) {
      const label = barCarry2Algo.classify({ ...baseInput, ...sides });
      expect(label).not.toBeNull();
      expect(declared.has(label as string)).toBe(true);
    }
  });

  it("ignores ema/atr/rsi inputs entirely", () => {
    const a = barCarry2Algo.classify({
      leadingSide: "up",
      prev5mDirection: "up",
      ema20: null,
      ema50: null,
      atr14: null,
      atr50: null,
      rsi14: null,
      atr3: null,
      rsiDivergence5mW3: null,
      rsiDivergence5mW5: null,
      rsiDivergence5mW7: null,
      rsiDivergence15mW3: null,
      rsiDivergence15mW5: null,
      rsiDivergence15mW7: null,
    });
    expect(a).toBe("continuation");
  });
});
