import { alignMarketSeries } from "@alea/lib/marketSeries/align";
import type { MarketBar } from "@alea/lib/marketSeries/types";
import { describe, expect, it } from "bun:test";

describe("alignMarketSeries", () => {
  it("keeps Pyth as the canonical timeline and inserts null Coinbase gaps", () => {
    const aligned = alignMarketSeries({
      pyth: [bar(0), bar(1), bar(2)],
      coinbase: [bar(0, { close: 200 }), bar(2, { close: 202 }), bar(99)],
    });

    expect(aligned.pyth.map((b) => b.openTimeMs)).toEqual([0, 60_000, 120_000]);
    expect(aligned.coinbase.map((b) => b?.close ?? null)).toEqual([
      200,
      null,
      202,
    ]);
  });
});

function bar(i: number, overrides: Partial<MarketBar> = {}): MarketBar {
  return {
    openTimeMs: i * 60_000,
    open: 100 + i,
    high: 101 + i,
    low: 99 + i,
    close: 100.5 + i,
    volume: 10 + i,
    ...overrides,
  };
}
