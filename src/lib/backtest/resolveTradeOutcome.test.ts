import { resolveTradeOutcome } from "@alea/lib/backtest/resolveTradeOutcome";
import type { MarketBar } from "@alea/lib/marketSeries/types";
import { describe, expect, it } from "bun:test";

const bar = ({
  open,
  high,
  low,
  close,
  openTimeMs = 0,
}: {
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly openTimeMs?: number;
}): MarketBar => ({
  openTimeMs,
  open,
  high,
  low,
  close,
  volume: 0,
});

describe("resolveTradeOutcome", () => {
  it("wins long when TP is touched before SL", () => {
    const bars = [
      bar({ open: 100, high: 102, low: 99, close: 101 }),
      bar({ open: 101, high: 104, low: 100, close: 103 }), // touches +3% TP at 103
    ];
    expect(
      resolveTradeOutcome({
        direction: "up",
        entryPrice: 100,
        outcomeBars: bars,
        takeProfitPct: 0.03,
        stopLossPct: 0.02,
      }),
    ).toBe("win");
  });

  it("loses long when SL is touched first", () => {
    const bars = [
      bar({ open: 100, high: 101, low: 97.5, close: 98 }), // touches -2% SL at 98
    ];
    expect(
      resolveTradeOutcome({
        direction: "up",
        entryPrice: 100,
        outcomeBars: bars,
        takeProfitPct: 0.03,
        stopLossPct: 0.02,
      }),
    ).toBe("loss");
  });

  it("loses long via time-stop when neither side is touched", () => {
    const bars = [
      bar({ open: 100, high: 102, low: 99, close: 101 }),
      bar({ open: 101, high: 102.5, low: 99.5, close: 100.5 }),
    ];
    expect(
      resolveTradeOutcome({
        direction: "up",
        entryPrice: 100,
        outcomeBars: bars,
        takeProfitPct: 0.03,
        stopLossPct: 0.02,
      }),
    ).toBe("loss");
  });

  it("treats SL as touched first when both are inside the same bar's range (conservative)", () => {
    // A single bar that ranges from 96 (SL=98) to 105 (TP=103). OHLC
    // cannot tell us which came first, so we book a loss.
    const bars = [bar({ open: 100, high: 105, low: 96, close: 102 })];
    expect(
      resolveTradeOutcome({
        direction: "up",
        entryPrice: 100,
        outcomeBars: bars,
        takeProfitPct: 0.03,
        stopLossPct: 0.02,
      }),
    ).toBe("loss");
  });

  it("wins short when TP is touched before SL", () => {
    const bars = [
      bar({ open: 100, high: 101, low: 96, close: 97 }), // touches -3% TP at 97
    ];
    expect(
      resolveTradeOutcome({
        direction: "down",
        entryPrice: 100,
        outcomeBars: bars,
        takeProfitPct: 0.03,
        stopLossPct: 0.02,
      }),
    ).toBe("win");
  });

  it("loses short when SL is touched first", () => {
    const bars = [
      bar({ open: 100, high: 102.5, low: 99, close: 101 }), // touches +2% SL at 102
    ];
    expect(
      resolveTradeOutcome({
        direction: "down",
        entryPrice: 100,
        outcomeBars: bars,
        takeProfitPct: 0.03,
        stopLossPct: 0.02,
      }),
    ).toBe("loss");
  });

  it("rejects non-positive entry price", () => {
    expect(() =>
      resolveTradeOutcome({
        direction: "up",
        entryPrice: 0,
        outcomeBars: [],
        takeProfitPct: 0.03,
        stopLossPct: 0.02,
      }),
    ).toThrow();
  });

  it("rejects non-positive thresholds", () => {
    expect(() =>
      resolveTradeOutcome({
        direction: "up",
        entryPrice: 100,
        outcomeBars: [],
        takeProfitPct: 0,
        stopLossPct: 0.02,
      }),
    ).toThrow();
    expect(() =>
      resolveTradeOutcome({
        direction: "up",
        entryPrice: 100,
        outcomeBars: [],
        takeProfitPct: 0.03,
        stopLossPct: 0,
      }),
    ).toThrow();
  });
});
