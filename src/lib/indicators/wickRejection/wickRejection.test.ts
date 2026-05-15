import { computeWickRejectionSignals } from "@alea/lib/indicators/wickRejection";
import type { MarketBar } from "@alea/lib/marketSeries/types";
import { describe, expect, it } from "bun:test";

describe("computeWickRejectionSignals", () => {
  it("detects a bearish high sweep that closes back below the prior high", () => {
    const signals = computeWickRejectionSignals({
      bars: [
        bar(0, { high: 101, low: 99, close: 100 }),
        bar(1, { high: 102, low: 100, close: 101 }),
        bar(2, { high: 103, low: 101, close: 102 }),
        bar(3, { open: 102, high: 106, low: 101, close: 102.5 }),
      ],
      lookbackBars: 3,
      minWickToRange: 0.5,
    });

    expect(signals).toEqual([
      {
        kind: "bearish_high_sweep",
        index: 3,
        priorExtreme: 103,
        wickToRange: 0.7,
      },
    ]);
  });

  it("detects a bullish low sweep that closes back above the prior low", () => {
    const signals = computeWickRejectionSignals({
      bars: [
        bar(0, { high: 101, low: 99, close: 100 }),
        bar(1, { high: 100, low: 98, close: 99 }),
        bar(2, { high: 99, low: 97, close: 98 }),
        bar(3, { open: 98, high: 99, low: 94, close: 97.5 }),
      ],
      lookbackBars: 3,
      minWickToRange: 0.5,
    });

    expect(signals).toEqual([
      {
        kind: "bullish_low_sweep",
        index: 3,
        priorExtreme: 97,
        wickToRange: 0.7,
      },
    ]);
  });

  it("ignores clean breakouts and shallow wicks", () => {
    const signals = computeWickRejectionSignals({
      bars: [
        bar(0, { high: 101, low: 99, close: 100 }),
        bar(1, { high: 102, low: 100, close: 101 }),
        bar(2, { high: 103, low: 101, close: 102 }),
        bar(3, { open: 102, high: 106, low: 101, close: 105 }),
        bar(4, { open: 105, high: 106, low: 103, close: 104 }),
      ],
      lookbackBars: 3,
      minWickToRange: 0.5,
    });

    expect(signals).toEqual([]);
  });
});

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
