import {
  applyMarketDataEventToSamplerState,
  type MarketPriceState,
  sampleNormalizedUpPrice,
} from "@alea/lib/polymarket/priceSampler";
import { describe, expect, it } from "bun:test";

function emptyState(): MarketPriceState {
  return {
    up: { bid: null, ask: null, last: null },
    down: { bid: null, ask: null, last: null },
  };
}

describe("sampleNormalizedUpPrice", () => {
  it("prefers the direct UP midpoint", () => {
    const state = emptyState();
    state.up.bid = 0.49;
    state.up.ask = 0.51;
    state.down.bid = 0.47;
    state.down.ask = 0.48;

    expect(sampleNormalizedUpPrice({ state })).toEqual({
      price: 0.5,
      quality: 0,
    });
  });

  it("infers UP price from the DOWN midpoint when UP BBO is missing", () => {
    const state = emptyState();
    state.down.bid = 0.42;
    state.down.ask = 0.44;

    expect(sampleNormalizedUpPrice({ state })).toEqual({
      price: 0.5700000000000001,
      quality: 1,
    });
  });

  it("falls back to last trade prices", () => {
    const state = emptyState();
    state.down.last = 0.61;

    expect(sampleNormalizedUpPrice({ state })).toEqual({
      price: 0.39,
      quality: 3,
    });
  });
});

describe("applyMarketDataEventToSamplerState", () => {
  it("updates token quote state from book, bbo, and trade frames", () => {
    const state = emptyState();
    const session = { state };
    const tokenRoutes = new Map([
      ["UP", { state: session.state, side: "up" as const }],
      ["DOWN", { state: session.state, side: "down" as const }],
    ]);

    applyMarketDataEventToSamplerState({
      tokenRoutes,
      event: {
        kind: "book",
        vendorRef: "condition",
        outcomeRef: "UP",
        bids: [
          { price: 0.48, size: 10 },
          { price: 0.49, size: 10 },
        ],
        asks: [
          { price: 0.52, size: 10 },
          { price: 0.51, size: 10 },
        ],
        atMs: 1,
      },
    });
    applyMarketDataEventToSamplerState({
      tokenRoutes,
      event: {
        kind: "best-bid-ask",
        vendorRef: "condition",
        outcomeRef: "DOWN",
        bestBid: 0.46,
        bestAsk: 0.47,
        atMs: 2,
      },
    });
    applyMarketDataEventToSamplerState({
      tokenRoutes,
      event: {
        kind: "trade",
        vendorRef: "condition",
        outcomeRef: "UP",
        price: 0.5,
        size: 1,
        side: "BUY",
        atMs: 3,
      },
    });

    expect(state).toEqual({
      up: { bid: 0.49, ask: 0.51, last: 0.5 },
      down: { bid: 0.46, ask: 0.47, last: null },
    });
  });
});
