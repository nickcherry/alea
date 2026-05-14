import {
  decodePriceSamples,
  encodePriceSamples,
  type PriceSampleTick,
} from "@alea/lib/polymarket/priceSampleCodec";
import {
  applyMarketDataEventToSamplerState,
  type MarketPriceState,
  samplePriceMids,
} from "@alea/lib/polymarket/priceSampler";
import { describe, expect, it } from "bun:test";

function emptyState(): MarketPriceState {
  return {
    up: { bid: null, ask: null, last: null },
    down: { bid: null, ask: null, last: null },
  };
}

describe("samplePriceMids", () => {
  it("returns both BBO mids when each side has a tight book", () => {
    const state = emptyState();
    state.up.bid = 0.49;
    state.up.ask = 0.51;
    state.down.bid = 0.47;
    state.down.ask = 0.49;

    expect(samplePriceMids({ state })).toEqual({
      upBps: 5_000,
      downBps: 4_800,
    });
  });

  it("returns null per side when that side lacks a tight book", () => {
    const state = emptyState();
    state.down.bid = 0.42;
    state.down.ask = 0.44;

    expect(samplePriceMids({ state })).toEqual({
      upBps: null,
      downBps: 4_300,
    });
  });

  it("ignores last-trade prices entirely", () => {
    const state = emptyState();
    state.up.last = 0.5;
    state.down.last = 0.6;

    expect(samplePriceMids({ state })).toEqual({
      upBps: null,
      downBps: null,
    });
  });
});

describe("packed-tick codec", () => {
  it("round-trips ticks with both sides present", () => {
    const ticks: readonly PriceSampleTick[] = [
      { offsetMs: 0, upBps: 5_000, downBps: 5_000 },
      { offsetMs: 1_000, upBps: 5_123, downBps: 4_877 },
      { offsetMs: 299_000, upBps: 9_999, downBps: 1 },
    ];
    expect(decodePriceSamples(encodePriceSamples(ticks))).toEqual(ticks);
  });

  it("round-trips missing sides via the null sentinel", () => {
    const ticks: readonly PriceSampleTick[] = [
      { offsetMs: 0, upBps: null, downBps: 5_000 },
      { offsetMs: 1_000, upBps: 5_000, downBps: null },
      { offsetMs: 2_000, upBps: null, downBps: null },
    ];
    expect(decodePriceSamples(encodePriceSamples(ticks))).toEqual(ticks);
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
