import {
  alignBarSeries,
  selectTrailingFilterWindow,
} from "@alea/lib/filters/barSeries";
import type { FilterBar } from "@alea/lib/filters/types";
import { describe, expect, it } from "bun:test";

describe("alignBarSeries", () => {
  it("uses Pyth as the canonical timeline and aligns Coinbase by open time", () => {
    const series = alignBarSeries({
      pyth: [bar(0, 1), bar(300_000, 2), bar(600_000, 3)],
      coinbase: [bar(300_000, 20), bar(900_000, 90)],
    });

    expect(series.pyth.map((b) => b.close)).toEqual([1, 2, 3]);
    expect(series.coinbase.map((b) => b?.close ?? null)).toEqual([
      null,
      20,
      null,
    ]);
  });
});

describe("selectTrailingFilterWindow", () => {
  it("routes Pyth filters to Pyth bars", () => {
    const series = alignBarSeries({
      pyth: [bar(0, 1), bar(300_000, 2)],
      coinbase: [bar(0, 10), bar(300_000, 20)],
    });

    const window = selectTrailingFilterWindow({
      series,
      filter: { barSource: "pyth" },
      requiredBars: 2,
    });

    expect(window?.map((b) => b.close)).toEqual([1, 2]);
  });

  it("routes Coinbase filters to Coinbase bars and abstains on gaps", () => {
    const complete = alignBarSeries({
      pyth: [bar(0, 1), bar(300_000, 2)],
      coinbase: [bar(0, 10), bar(300_000, 20)],
    });
    const gapped = alignBarSeries({
      pyth: [bar(0, 1), bar(300_000, 2)],
      coinbase: [bar(0, 10)],
    });

    expect(
      selectTrailingFilterWindow({
        series: complete,
        filter: { barSource: "coinbase" },
        requiredBars: 2,
      })?.map((b) => b.close),
    ).toEqual([10, 20]);
    expect(
      selectTrailingFilterWindow({
        series: gapped,
        filter: { barSource: "coinbase" },
        requiredBars: 2,
      }),
    ).toBeNull();
  });
});

function bar(openTimeMs: number, close: number): FilterBar {
  return {
    openTimeMs,
    open: close,
    high: close,
    low: close,
    close,
    volume: close,
  };
}
