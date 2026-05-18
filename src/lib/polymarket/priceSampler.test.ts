import {
  decodePriceSamples,
  encodePriceSamples,
  type PriceSampleTick,
} from "@alea/lib/polymarket/priceSampleCodec";
import {
  applyMarketDataEventToSamplerState,
  type MarketPriceState,
  PRE_MARKET_SAMPLE_LEAD_MS,
  type SampleableSession,
  sampleActiveSessions,
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

  it("round-trips negative pre-market offsets", () => {
    const ticks: readonly PriceSampleTick[] = [
      { offsetMs: -3_600_000, upBps: 5_000, downBps: 5_000 },
      { offsetMs: -1_000, upBps: 5_100, downBps: 4_900 },
      { offsetMs: 0, upBps: 5_050, downBps: 4_950 },
      { offsetMs: 299_000, upBps: 6_000, downBps: 4_000 },
    ];
    expect(decodePriceSamples(encodePriceSamples(ticks))).toEqual(ticks);
  });

  it("decodes legacy v1 (u32 offsets) buffers", () => {
    const tickCount = 2;
    const buffer = Buffer.alloc(8 + tickCount * 8);
    buffer.writeUInt16LE(1, 0);
    buffer.writeUInt16LE(0, 2);
    buffer.writeUInt32LE(tickCount, 4);
    buffer.writeUInt32LE(0, 8);
    buffer.writeUInt16LE(5_000, 12);
    buffer.writeUInt16LE(5_000, 14);
    buffer.writeUInt32LE(60_000, 16);
    buffer.writeUInt16LE(5_200, 20);
    buffer.writeUInt16LE(4_800, 22);
    expect(decodePriceSamples(buffer)).toEqual([
      { offsetMs: 0, upBps: 5_000, downBps: 5_000 },
      { offsetMs: 60_000, upBps: 5_200, downBps: 4_800 },
    ]);
  });
});

describe("sampleActiveSessions", () => {
  const windowStartTsMs = 1_778_517_600_000;
  const windowEndTsMs = windowStartTsMs + 3_600_000;

  function freshSession(): SampleableSession {
    return {
      windowStartTsMs,
      windowEndTsMs,
      sampleIntervalMs: 1_000,
      state: {
        up: { bid: 0.49, ask: 0.51, last: null },
        down: { bid: 0.47, ask: 0.49, last: null },
      },
      samples: [],
      nextSampleAtMs: windowStartTsMs - PRE_MARKET_SAMPLE_LEAD_MS,
      firstSampleTsMs: null,
      lastSampleTsMs: null,
      missingSampleCount: 0,
    };
  }

  it("skips sampling before the pre-market lead window", () => {
    const session = freshSession();
    sampleActiveSessions({
      sessions: new Map([["k", session]]),
      nowMs: windowStartTsMs - PRE_MARKET_SAMPLE_LEAD_MS - 1,
    });
    expect(session.samples).toEqual([]);
  });

  it("captures pre-market ticks with negative offsetMs", () => {
    const session = freshSession();
    const nowMs = windowStartTsMs - PRE_MARKET_SAMPLE_LEAD_MS;
    sampleActiveSessions({ sessions: new Map([["k", session]]), nowMs });
    expect(session.samples).toEqual([
      { offsetMs: -PRE_MARKET_SAMPLE_LEAD_MS, upBps: 5_000, downBps: 4_800 },
    ]);
  });

  it("captures intra-market ticks with non-negative offsetMs", () => {
    const session = freshSession();
    session.nextSampleAtMs = windowStartTsMs + 30_000;
    sampleActiveSessions({
      sessions: new Map([["k", session]]),
      nowMs: windowStartTsMs + 30_000,
    });
    expect(session.samples).toEqual([
      { offsetMs: 30_000, upBps: 5_000, downBps: 4_800 },
    ]);
  });

  it("stops sampling once window has ended", () => {
    const session = freshSession();
    session.nextSampleAtMs = windowEndTsMs;
    sampleActiveSessions({
      sessions: new Map([["k", session]]),
      nowMs: windowEndTsMs,
    });
    expect(session.samples).toEqual([]);
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
