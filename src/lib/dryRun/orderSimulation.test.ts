import { DRY_RUN_ORDER_MAX_QUOTE_AGE_MS } from "@alea/constants/dryRun";
import {
  averageWinningVoteConfidence,
  type DryRunMarketPriceState,
  resolveDryRunOrderFill,
  resolveDryRunOrderPlacement,
} from "@alea/lib/dryRun/orderSimulation";
import { describe, expect, it } from "bun:test";

const NOW_MS = 1_800_000_003_000;

function emptyState(): DryRunMarketPriceState {
  return {
    up: { bid: null, bidAtMs: null, ask: null, askAtMs: null, tickSize: null },
    down: {
      bid: null,
      bidAtMs: null,
      ask: null,
      askAtMs: null,
      tickSize: null,
    },
  };
}

function setQuote({
  state,
  side,
  bid,
  ask,
  atMs = NOW_MS,
  tickSize = 0.001,
}: {
  readonly state: DryRunMarketPriceState;
  readonly side: "up" | "down";
  readonly bid: number;
  readonly ask: number;
  readonly atMs?: number;
  readonly tickSize?: number | null;
}): void {
  state[side].bid = bid;
  state[side].bidAtMs = atMs;
  state[side].ask = ask;
  state[side].askAtMs = atMs;
  state[side].tickSize = tickSize;
}

describe("resolveDryRunOrderPlacement", () => {
  it("places a predicted-side buy one tick below the same-side best ask when confidence clears the limit", () => {
    const state = emptyState();
    setQuote({ state, side: "up", bid: 0.495, ask: 0.505 });

    expect(
      resolveDryRunOrderPlacement({
        prediction: "u",
        state,
        nowMs: NOW_MS,
        confidence: 0.54,
      }),
    ).toEqual({
      status: "placed",
      observedPrice: 0.5,
      limitPrice: 0.504,
      confidence: 0.54,
      fillPrice: null,
    });
  });

  it("falls back to the venue-style penny tick when no tick metadata is available", () => {
    const state = emptyState();
    setQuote({
      state,
      side: "up",
      bid: 0.49,
      ask: 0.5,
      tickSize: null,
    });

    expect(
      resolveDryRunOrderPlacement({
        prediction: "u",
        state,
        nowMs: NOW_MS,
        confidence: 0.54,
      }),
    ).toMatchObject({
      status: "placed",
      limitPrice: 0.49,
    });
  });

  it("skips when the observed predicted-side price is outside the 50c window", () => {
    const state = emptyState();
    setQuote({ state, side: "down", bid: 0.535, ask: 0.545 });

    expect(
      resolveDryRunOrderPlacement({
        prediction: "d",
        state,
        nowMs: NOW_MS,
        confidence: 0.7,
      }),
    ).toMatchObject({
      status: "skipped_price_window",
      observedPrice: 0.54,
      limitPrice: 0.544,
    });
  });

  it("skips when committee confidence does not clear the limit price", () => {
    const state = emptyState();
    setQuote({ state, side: "up", bid: 0.515, ask: 0.525 });

    expect(
      resolveDryRunOrderPlacement({
        prediction: "u",
        state,
        nowMs: NOW_MS,
        confidence: 0.512,
      }),
    ).toMatchObject({
      status: "skipped_confidence",
      observedPrice: 0.52,
      limitPrice: 0.524,
    });
  });

  it("requires a fresh predicted-side ask for aggressive maker-buy pricing", () => {
    const state = emptyState();
    setQuote({ state, side: "up", bid: 0.49, ask: 0.5 });

    expect(
      resolveDryRunOrderPlacement({
        prediction: "d",
        state,
        nowMs: NOW_MS,
        confidence: 0.53,
      }),
    ).toEqual({ status: "skipped_no_price" });
  });

  it("skips when the book quote is too stale at placement time", () => {
    const state = emptyState();
    setQuote({
      state,
      side: "up",
      bid: 0.495,
      ask: 0.505,
      atMs: NOW_MS - DRY_RUN_ORDER_MAX_QUOTE_AGE_MS - 1,
    });

    expect(
      resolveDryRunOrderPlacement({
        prediction: "u",
        state,
        nowMs: NOW_MS,
        confidence: 0.54,
      }),
    ).toEqual({ status: "skipped_no_price" });
  });
});

describe("resolveDryRunOrderFill", () => {
  it("fills a resting predicted-side buy when the ask trades through the limit", () => {
    const state = emptyState();
    state.down.ask = 0.502;
    state.down.askAtMs = NOW_MS;

    expect(
      resolveDryRunOrderFill({
        prediction: "d",
        state,
        limitPrice: 0.505,
        nowMs: NOW_MS,
      }),
    ).toBe(0.502);
  });

  it("does not fill when the predicted-side book stays above the limit", () => {
    const state = emptyState();
    state.up.ask = 0.511;
    state.up.askAtMs = NOW_MS;

    expect(
      resolveDryRunOrderFill({
        prediction: "u",
        state,
        limitPrice: 0.505,
        nowMs: NOW_MS,
      }),
    ).toBeNull();
  });

  it("does not fill from stale ask evidence", () => {
    const state = emptyState();
    state.up.ask = 0.5;
    state.up.askAtMs = NOW_MS - DRY_RUN_ORDER_MAX_QUOTE_AGE_MS - 1;

    expect(
      resolveDryRunOrderFill({
        prediction: "u",
        state,
        limitPrice: 0.505,
        nowMs: NOW_MS,
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
