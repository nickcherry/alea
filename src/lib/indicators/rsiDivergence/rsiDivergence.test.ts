import {
  computeRsiDivergenceSignals,
  type RsiDivergenceKind,
} from "@alea/lib/indicators/rsiDivergence";
import type { MarketBar } from "@alea/lib/marketSeries/types";
import { describe, expect, it } from "bun:test";

describe("computeRsiDivergenceSignals", () => {
  it("detects regular bullish divergence from lower price low and higher RSI low", () => {
    const signals = computeRsiDivergenceSignals({
      bars: barsFromLows([100, 99, 95, 99, 100, 98, 90, 98, 101]),
      rsi: [50, 45, 25, 45, 50, 44, 35, 46, 52],
      leftBars: 1,
      rightBars: 1,
      minPivotDistance: 1,
      maxPivotDistance: 10,
    });

    expect(kinds(signals)).toContain("regular_bullish");
    expect(signals.find((s) => s.kind === "regular_bullish")).toMatchObject({
      pivotIndex: 6,
      previousPivotIndex: 2,
      confirmedIndex: 7,
    });
  });

  it("detects hidden bullish divergence from higher price low and lower RSI low", () => {
    const signals = computeRsiDivergenceSignals({
      bars: barsFromLows([100, 99, 90, 99, 100, 98, 95, 98, 101]),
      rsi: [50, 45, 35, 45, 50, 44, 25, 46, 52],
      leftBars: 1,
      rightBars: 1,
      minPivotDistance: 1,
      maxPivotDistance: 10,
    });

    expect(kinds(signals)).toContain("hidden_bullish");
  });

  it("detects regular bearish divergence from higher price high and lower RSI high", () => {
    const signals = computeRsiDivergenceSignals({
      bars: barsFromHighs([100, 101, 110, 101, 100, 102, 115, 102, 99]),
      rsi: [50, 55, 75, 55, 50, 56, 65, 54, 48],
      leftBars: 1,
      rightBars: 1,
      minPivotDistance: 1,
      maxPivotDistance: 10,
    });

    expect(kinds(signals)).toContain("regular_bearish");
  });

  it("detects hidden bearish divergence from lower price high and higher RSI high", () => {
    const signals = computeRsiDivergenceSignals({
      bars: barsFromHighs([100, 101, 115, 101, 100, 102, 110, 102, 99]),
      rsi: [50, 55, 65, 55, 50, 56, 75, 54, 48],
      leftBars: 1,
      rightBars: 1,
      minPivotDistance: 1,
      maxPivotDistance: 10,
    });

    expect(kinds(signals)).toContain("hidden_bearish");
  });
});

function kinds(
  signals: readonly { readonly kind: RsiDivergenceKind }[],
): readonly RsiDivergenceKind[] {
  return signals.map((signal) => signal.kind);
}

function barsFromLows(lows: readonly number[]): readonly MarketBar[] {
  return lows.map((low, i) =>
    bar(i, {
      low,
      high: low + 10,
      open: low + 5,
      close: low + 6,
    }),
  );
}

function barsFromHighs(highs: readonly number[]): readonly MarketBar[] {
  return highs.map((high, i) =>
    bar(i, {
      high,
      low: high - 10,
      open: high - 5,
      close: high - 6,
    }),
  );
}

function bar(i: number, overrides: Partial<MarketBar>): MarketBar {
  return {
    openTimeMs: i * 60_000,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 0,
    ...overrides,
  };
}

