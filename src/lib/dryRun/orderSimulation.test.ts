import {
  averageWinningVoteConfidence,
  type DryRunMarketPriceState,
  resolveDryRunOrderFill,
  resolveDryRunOrderPlacement,
} from "@alea/lib/dryRun/orderSimulation";
import { describe, expect, it } from "bun:test";

function emptyState(): DryRunMarketPriceState {
  return {
    up: { bid: null, ask: null, last: null },
    down: { bid: null, ask: null, last: null },
  };
}

describe("resolveDryRunOrderPlacement", () => {
  it("places a predicted-side buy above the observed midpoint when confidence clears the limit", () => {
    const state = emptyState();
    state.up.bid = 0.495;
    state.up.ask = 0.505;

    expect(
      resolveDryRunOrderPlacement({
        prediction: "u",
        state,
        confidence: 0.54,
      }),
    ).toEqual({
      status: "filled",
      observedPrice: 0.5,
      limitPrice: 0.505,
      confidence: 0.54,
      fillPrice: 0.505,
    });
  });

  it("skips when the observed predicted-side price is outside the 50c window", () => {
    const state = emptyState();
    state.down.bid = 0.535;
    state.down.ask = 0.545;

    expect(
      resolveDryRunOrderPlacement({
        prediction: "d",
        state,
        confidence: 0.7,
      }),
    ).toMatchObject({
      status: "skipped_price_window",
      observedPrice: 0.54,
      limitPrice: 0.545,
    });
  });

  it("skips when committee confidence does not clear the limit price", () => {
    const state = emptyState();
    state.up.bid = 0.515;
    state.up.ask = 0.525;

    expect(
      resolveDryRunOrderPlacement({
        prediction: "u",
        state,
        confidence: 0.522,
      }),
    ).toMatchObject({
      status: "skipped_confidence",
      observedPrice: 0.52,
      limitPrice: 0.525,
    });
  });

  it("can infer the predicted-side price from the opposite token", () => {
    const state = emptyState();
    state.up.bid = 0.49;
    state.up.ask = 0.5;

    expect(
      resolveDryRunOrderPlacement({
        prediction: "d",
        state,
        confidence: 0.53,
      }),
    ).toMatchObject({
      status: "placed",
      observedPrice: 0.505,
      limitPrice: 0.51,
    });
  });
});

describe("resolveDryRunOrderFill", () => {
  it("fills a resting predicted-side buy when the ask trades through the limit", () => {
    const state = emptyState();
    state.down.ask = 0.502;

    expect(
      resolveDryRunOrderFill({
        prediction: "d",
        state,
        limitPrice: 0.505,
      }),
    ).toBe(0.502);
  });

  it("does not fill when the predicted-side book stays above the limit", () => {
    const state = emptyState();
    state.up.ask = 0.511;

    expect(
      resolveDryRunOrderFill({
        prediction: "u",
        state,
        limitPrice: 0.505,
      }),
    ).toBeNull();
  });
});

describe("averageWinningVoteConfidence", () => {
  it("averages usable selected-regime win rates", () => {
    expect(
      averageWinningVoteConfidence({
        prediction: "up",
        winRates: [0.54, null, 0.58],
      }),
    ).toBeCloseTo(0.56, 8);
  });
});
