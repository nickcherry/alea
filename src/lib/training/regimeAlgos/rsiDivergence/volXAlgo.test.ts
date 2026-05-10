import {
  createVolXRsiDivergenceAlgo,
  volXRsiDivergenceAlgos,
} from "@alea/lib/training/regimeAlgos/rsiDivergence/volXAlgo";
import type { RegimeClassifierInput } from "@alea/lib/training/regimeAlgos/types";
import { describe, expect, it } from "bun:test";

const baseInput: RegimeClassifierInput = {
  leadingSide: "up",
  ema20: 100,
  ema50: 100,
  atr14: 1,
  atr50: 1,
  rsi14: 50,
  atr3: 1,
  prev5mDirection: "up",
  rsiDivergence5mW3: null,
  rsiDivergence5mW5: null,
  rsiDivergence5mW7: null,
  rsiDivergence15mW3: null,
  rsiDivergence15mW5: null,
  rsiDivergence15mW7: null,
};

describe("createVolXRsiDivergenceAlgo", () => {
  const algo = createVolXRsiDivergenceAlgo({
    timeframe: "5m",
    lookbackBars: 5,
  });

  it("declares 15 combined regime labels", () => {
    expect(algo.regimes).toHaveLength(15);
    expect(algo.regimes).toContain("low_vol_bull_div");
    expect(algo.regimes).toContain("mid_vol_no_div");
    expect(algo.regimes).toContain("high_vol_hidden_bear_div");
  });

  it("uses the configured (timeframe, lookback) for the divergence axis", () => {
    // ATR 0.5 / 1.0 = 0.5 → low_vol; div 5m w5 set, others not.
    expect(
      algo.classify({
        ...baseInput,
        atr14: 0.5,
        atr50: 1,
        rsiDivergence5mW5: "bull_div",
        // Wrong lookback shouldn't be read.
        rsiDivergence5mW3: "bear_div",
      }),
    ).toBe("low_vol_bull_div");
  });

  it("returns null when the vol axis can't classify (vol input missing)", () => {
    expect(
      algo.classify({
        ...baseInput,
        atr14: null,
        atr50: 1,
        rsiDivergence5mW5: "bull_div",
      }),
    ).toBeNull();
  });

  it("returns null when the div axis is null even if vol classifies", () => {
    expect(
      algo.classify({
        ...baseInput,
        atr14: 0.5,
        atr50: 1,
        rsiDivergence5mW5: null,
      }),
    ).toBeNull();
  });

  it("emits combined labels covering all three vol tiers", () => {
    expect(
      algo.classify({
        ...baseInput,
        atr14: 0.5,
        atr50: 1,
        rsiDivergence5mW5: "no_div",
      }),
    ).toBe("low_vol_no_div");
    expect(
      algo.classify({
        ...baseInput,
        atr14: 1,
        atr50: 1,
        rsiDivergence5mW5: "no_div",
      }),
    ).toBe("mid_vol_no_div");
    expect(
      algo.classify({
        ...baseInput,
        atr14: 2,
        atr50: 1,
        rsiDivergence5mW5: "no_div",
      }),
    ).toBe("high_vol_no_div");
  });

  it("never emits a label outside its declared regimes", () => {
    const declared = new Set(algo.regimes);
    const samples = [
      { atr14: 0.5, atr50: 1, rsiDivergence5mW5: "bull_div" as const },
      { atr14: 1, atr50: 1, rsiDivergence5mW5: "hidden_bull_div" as const },
      { atr14: 2, atr50: 1, rsiDivergence5mW5: "bear_div" as const },
      { atr14: 2, atr50: 1, rsiDivergence5mW5: "hidden_bear_div" as const },
      { atr14: 1, atr50: 1, rsiDivergence5mW5: "no_div" as const },
    ];
    for (const sample of samples) {
      const label = algo.classify({ ...baseInput, ...sample });
      expect(label).not.toBeNull();
      expect(declared.has(label as string)).toBe(true);
    }
  });
});

describe("volXRsiDivergenceAlgos", () => {
  it("registers six variants, one per (timeframe, lookback) pairing", () => {
    expect(volXRsiDivergenceAlgos).toHaveLength(6);
    const ids = volXRsiDivergenceAlgos.map((a) => a.id);
    expect(ids).toEqual([
      "vol3_x_rsidiv_5m_w3",
      "vol3_x_rsidiv_5m_w5",
      "vol3_x_rsidiv_5m_w7",
      "vol3_x_rsidiv_15m_w3",
      "vol3_x_rsidiv_15m_w5",
      "vol3_x_rsidiv_15m_w7",
    ]);
  });

  it("each variant declares 15 unique combined regime labels", () => {
    for (const algo of volXRsiDivergenceAlgos) {
      expect(algo.regimes).toHaveLength(15);
      const unique = new Set(algo.regimes);
      expect(unique.size).toBe(15);
    }
  });
});
