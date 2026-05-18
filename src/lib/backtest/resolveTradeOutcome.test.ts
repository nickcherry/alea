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
  it("wins long when any bar high reaches the take-profit", () => {
    const bars = [
      bar({ open: 100, high: 102, low: 99, close: 101 }),
      bar({ open: 101, high: 106, low: 100, close: 105 }), // touches TP
    ];
    expect(
      resolveTradeOutcome({
        direction: "up",
        entryPrice: 100,
        outcomeBars: bars,
        takeProfitPct: 0.05,
      }),
    ).toBe("win");
  });

  it("loses long when no bar high reaches the take-profit", () => {
    const bars = [
      bar({ open: 100, high: 103, low: 95, close: 96 }),
      bar({ open: 96, high: 99, low: 90, close: 92 }),
    ];
    expect(
      resolveTradeOutcome({
        direction: "up",
        entryPrice: 100,
        outcomeBars: bars,
        takeProfitPct: 0.05,
      }),
    ).toBe("loss");
  });

  it("wins short when any bar low reaches the take-profit", () => {
    const bars = [
      bar({ open: 100, high: 101, low: 97, close: 98 }),
      bar({ open: 98, high: 99, low: 94, close: 95 }), // 94 < 95 (5% below 100)
    ];
    expect(
      resolveTradeOutcome({
        direction: "down",
        entryPrice: 100,
        outcomeBars: bars,
        takeProfitPct: 0.05,
      }),
    ).toBe("win");
  });

  it("loses short when no bar low reaches the take-profit", () => {
    const bars = [
      bar({ open: 100, high: 105, low: 99, close: 104 }),
      bar({ open: 104, high: 108, low: 100, close: 107 }),
    ];
    expect(
      resolveTradeOutcome({
        direction: "down",
        entryPrice: 100,
        outcomeBars: bars,
        takeProfitPct: 0.05,
      }),
    ).toBe("loss");
  });

  it("wins on the very first bar of the window when the entry bar itself touches TP", () => {
    const bars = [bar({ open: 100, high: 106, low: 99, close: 102 })];
    expect(
      resolveTradeOutcome({
        direction: "up",
        entryPrice: 100,
        outcomeBars: bars,
        takeProfitPct: 0.05,
      }),
    ).toBe("win");
  });

  it("rejects non-positive entry price", () => {
    expect(() =>
      resolveTradeOutcome({
        direction: "up",
        entryPrice: 0,
        outcomeBars: [],
        takeProfitPct: 0.05,
      }),
    ).toThrow();
  });

  it("rejects non-positive take-profit pct", () => {
    expect(() =>
      resolveTradeOutcome({
        direction: "up",
        entryPrice: 100,
        outcomeBars: [],
        takeProfitPct: 0,
      }),
    ).toThrow();
  });
});
