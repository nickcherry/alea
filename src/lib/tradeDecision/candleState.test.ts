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
      fetchCoinbaseBarsForHydrate: async () => [],
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

  it("uses the Coinbase buffer when selecting Coinbase refresh windows", () => {
    const state = stateWithBars(
      Array.from({ length: 20 }, (_, index) =>
        bar(index * 300_000, 90 + index, 100 + index),
      ),
    );
    state.coinbaseBars = [bar(0, 90, 100), bar(1_200_000, 100, 101)];

    expect(
      getRefreshFetchStartMs({
        state,
        currentOpenTimeMs: 6_000_000,
        limit: 20,
        source: "coinbase",
      }),
    ).toBe(0);
  });

  it("refreshes closed candles and builds the decision series without the active candle", async () => {
    const state = stateWithBars([bar(0, 90, 100)]);
    const refreshed = await refreshTradeDecisionCandleState({
      state,
      nowMs: 895_000,
      fetchCandles: async () => [
        candle(300_000, 100, 108),
        candle(600_000, 108, 111, 112, 107),
      ],
      fetchCoinbaseBarsForRefresh: async () => [],
    });

    expect(state.bars.map((b) => [b.openTimeMs, b.open, b.close])).toEqual([
      [0, 90, 100],
      [300_000, 100, 108],
    ]);
    expect(refreshed.referenceBar?.openTimeMs).toBe(300_000);
    expect(refreshed.seriesForDecision?.pyth.map((b) => b.openTimeMs)).toEqual([
      0, 300_000,
    ]);
    // No Coinbase bars returned by fetcher → every aligned slot is null.
    expect(refreshed.seriesForDecision?.coinbase).toEqual([null, null]);
  });

  it("aligns coinbase bars by openTimeMs into the bundle", async () => {
    const state = stateWithBars([bar(0, 90, 100)]);
    state.coinbaseBars = [
      { openTimeMs: 0, open: 90, high: 101, low: 89, close: 100, volume: 12 },
    ];
    const refreshed = await refreshTradeDecisionCandleState({
      state,
      nowMs: 895_000,
      fetchCandles: async () => [candle(300_000, 100, 108)],
      fetchCoinbaseBarsForRefresh: async () => [
        coinbaseCandle(300_000, 100, 108, 8),
        coinbaseCandle(600_000, 108, 113, 5),
      ],
    });

    expect(
      refreshed.seriesForDecision?.coinbase.map((b) => b?.volume ?? null),
    ).toEqual([12, 8]);
  });

  it("keeps the decision path alive when Coinbase refresh times out", async () => {
    const state = stateWithBars([bar(0, 90, 100)]);
    const refreshed = await refreshTradeDecisionCandleState({
      state,
      nowMs: 895_000,
      fetchCandles: async () => [candle(300_000, 100, 108)],
      fetchCoinbaseBarsForRefresh: async () =>
        new Promise<readonly Candle[]>(() => {}),
      coinbaseFetchTimeoutMs: 1,
    });

    expect(refreshed.seriesForDecision?.pyth.map((b) => b.openTimeMs)).toEqual([
      0, 300_000,
    ]);
    expect(refreshed.seriesForDecision?.coinbase).toEqual([null, null]);
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
    coinbaseBars: [],
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

function coinbaseCandle(
  openTimeMs: number,
  open: number,
  close: number,
  volume: number,
): Candle {
  return {
    source: "coinbase",
    asset: "btc",
    product: "spot",
    timeframe: "5m",
    timestamp: new Date(openTimeMs),
    open,
    high: Math.max(open, close),
    low: Math.min(open, close),
    close,
    volume,
  };
}
