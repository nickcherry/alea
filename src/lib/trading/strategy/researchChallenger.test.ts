import type { DecisionInputsBase } from "@alea/lib/trading/decision/evaluateDecision";
import { evaluateResearchChallengerDecision } from "@alea/lib/trading/strategy/researchChallenger";
import { describe, expect, it } from "bun:test";

const baseInputs: DecisionInputsBase = {
  asset: "btc",
  windowStartMs: 0,
  nowMs: 120_000,
  line: 100,
  currentPrice: 100.05,
  regimeInput: {
    leadingSide: "up",
    ema20: 101,
    ema50: 100,
    atr14: 1,
    atr50: 1,
    rsi14: null,
    atr3: null,
    prev5mDirection: "up",
  },
  upBestBid: 0.6,
  downBestBid: 0.1,
  upBestAsk: 0.61,
  downBestAsk: 0.11,
  upTokenId: "UP",
  downTokenId: "DOWN",
  minEdge: 0.05,
};

describe("evaluateResearchChallengerDecision", () => {
  it("trades only after the four source tables agree and execution quality passes", () => {
    const decision = evaluateResearchChallengerDecision(baseInputs);

    expect(decision).toMatchObject({
      kind: "trade",
      chosen: { side: "up", tokenId: "UP" },
    });
  });

  it("rejects assets outside the challenger roster", () => {
    const decision = evaluateResearchChallengerDecision({
      ...baseInputs,
      asset: "doge",
    });

    expect(decision).toMatchObject({
      kind: "skip",
      reason: "asset-excluded",
    });
  });

  it("requires all source tables to clear the model gates", () => {
    const decision = evaluateResearchChallengerDecision({
      ...baseInputs,
      minEdge: 0.99,
    });

    expect(decision).toMatchObject({
      kind: "skip",
      reason: "no-consensus",
    });
  });

  it("rejects consensus trades when the chosen ask fails execution quality", () => {
    const decision = evaluateResearchChallengerDecision({
      ...baseInputs,
      upBestAsk: 0.8,
    });

    expect(decision).toMatchObject({
      kind: "skip",
      reason: "execution-quality",
    });
  });
});
