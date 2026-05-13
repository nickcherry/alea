import type { LatestPythPrice } from "@alea/lib/livePrices/pyth/fetchLatestPythPrices";
import {
  getRefreshFetchStartMs,
  hydrateTradeDecisionCandleState,
  refreshTradeDecisionCandleState,
  type TradeDecisionCandleState,
  upsertFilterBars,
} from "@alea/lib/tradeDecision/candleState";
import type { Candle } from "@alea/types/candles";
import { describe, expect, it } from "bun:test";

describe("upsertFilterBars", () => {
  it("replaces duplicate bars and trims to the newest limit", () => {
    const bars = upsertFilterBars({
      existing: [bar(0, 1, 2), bar(300_000, 2, 3)],
      incoming: [bar(300_000, 20, 30), bar(600_000, 3, 4)],
      limit: 2,
    });
    expect(bars.map((b) => [b.openTimeMs, b.open, b.close])).toEqual([
      [300_000, 20, 30],
      [600_000, 3, 4],
    ]);
  });
});

describe("refreshTradeDecisionCandleState", () => {
  it("hydrates startup bars from fresh Pyth candles and drops the active partial bar", async () => {
    const requested: Array<{ start: number; end: number }> = [];

    const state = await hydrateTradeDecisionCandleState({
      asset: "btc",
      period: "5m",
      limit: 3,
      nowMs: 895_000,
      fetchCandles: async ({ start, end }) => {
        requested.push({ start: start.getTime(), end: end.getTime() });
        return [
          candle(0, 90, 100),
          candle(300_000, 100, 108),
          candle(600_000, 108, 111),
        ];
      },
    });

    expect(requested).toEqual([{ start: 0, end: 895_000 }]);
    expect(state.bars.map((b) => [b.openTimeMs, b.open, b.close])).toEqual([
      [0, 90, 100],
      [300_000, 100, 108],
    ]);
  });

  it("uses a small recent fetch window after startup hydration", () => {
    const state = stateWithBars(
      Array.from({ length: 20 }, (_, index) =>
        bar(index * 300_000, 90 + index, 100 + index),
      ),
    );

    expect(
      getRefreshFetchStartMs({
        state,
        currentOpenTimeMs: 6_000_000,
        limit: 20,
      }),
    ).toBe(3_600_000);
  });

  it("fetches from the last known bar when the in-memory state has a gap", () => {
    const state = stateWithBars([bar(0, 90, 100), bar(1_200_000, 100, 101)]);

    expect(
      getRefreshFetchStartMs({
        state,
        currentOpenTimeMs: 6_000_000,
        limit: 2,
      }),
    ).toBe(1_200_000);
  });

  it("refreshes closed candles and synthesizes the active candle from the latest Pyth price", async () => {
    const state = stateWithBars([bar(0, 90, 100)]);
    const refreshed = await refreshTradeDecisionCandleState({
      state,
      nowMs: 895_000,
      fetchCandles: async () => [
        candle(300_000, 100, 108),
        candle(600_000, 108, 111, 112, 107),
      ],
      fetchLatestPrices: async () =>
        new Map([["btc", latestPrice({ price: 115, publishTimeMs: 894_000 })]]),
    });

    expect(state.bars.map((b) => [b.openTimeMs, b.open, b.close])).toEqual([
      [0, 90, 100],
      [300_000, 100, 108],
    ]);
    expect(refreshed.syntheticBar).toEqual({
      openTimeMs: 600_000,
      open: 108,
      high: 115,
      low: 107,
      close: 115,
      volume: 0,
    });
    expect(refreshed.barsForDecision?.map((b) => b.openTimeMs)).toEqual([
      0, 300_000, 600_000,
    ]);
  });

  it("uses prior close when Pyth has not returned a partial active candle", async () => {
    const state = stateWithBars([bar(0, 90, 100)]);
    const refreshed = await refreshTradeDecisionCandleState({
      state,
      nowMs: 895_000,
      fetchCandles: async () => [candle(300_000, 100, 108)],
      fetchLatestPrices: async () =>
        new Map([["btc", latestPrice({ price: 104, publishTimeMs: 894_000 })]]),
    });

    expect(refreshed.syntheticBar).toEqual({
      openTimeMs: 600_000,
      open: 108,
      high: 108,
      low: 104,
      close: 104,
      volume: 0,
    });
  });

  it("does not synthesize a decision bar from a stale latest price", async () => {
    const state = stateWithBars([bar(0, 90, 100)]);
    const refreshed = await refreshTradeDecisionCandleState({
      state,
      nowMs: 895_000,
      maxPriceAgeMs: 15_000,
      fetchCandles: async () => [candle(300_000, 100, 108)],
      fetchLatestPrices: async () =>
        new Map([["btc", latestPrice({ price: 104, publishTimeMs: 870_000 })]]),
    });

    expect(refreshed.priceAgeMs).toBe(25_000);
    expect(refreshed.syntheticBar).toBeNull();
    expect(refreshed.barsForDecision).toBeNull();
  });
});

function stateWithBars(
  bars: TradeDecisionCandleState["bars"],
): TradeDecisionCandleState {
  return {
    asset: "btc",
    period: "5m",
    periodMs: 300_000,
    bars: [...bars],
    lastPredictedBoundary: 0,
    lastRefreshedAtMs: null,
  };
}

function bar(
  openTimeMs: number,
  open: number,
  close: number,
): TradeDecisionCandleState["bars"][number] {
  return {
    openTimeMs,
    open,
    high: Math.max(open, close),
    low: Math.min(open, close),
    close,
    volume: 0,
  };
}

function candle(
  openTimeMs: number,
  open: number,
  close: number,
  high = Math.max(open, close),
  low = Math.min(open, close),
): Candle {
  return {
    source: "pyth",
    asset: "btc",
    product: "spot",
    timeframe: "5m",
    timestamp: new Date(openTimeMs),
    open,
    high,
    low,
    close,
    volume: 0,
  };
}

function latestPrice({
  price,
  publishTimeMs,
}: {
  readonly price: number;
  readonly publishTimeMs: number;
}): LatestPythPrice {
  return {
    asset: "btc",
    price,
    conf: 0,
    publishTimeMs,
    receivedAtMs: publishTimeMs,
  };
}
