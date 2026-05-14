import { alignBarSeries } from "@alea/lib/filters/barSeries";
import type { FilterBar } from "@alea/lib/filters/types";
import {
  buildHistoricalDecisionAlignedSeries,
  createHistoricalDecisionSeries,
  selectHistoricalDecisionFilterWindow,
} from "@alea/lib/tradeDecision/historicalDecisionSeries";
import { describe, expect, it } from "bun:test";

describe("historical decision series", () => {
  it("synthesizes the active 5m decision bar from completed 1m candles at the lead", () => {
    const series = createHistoricalDecisionSeries({
      asset: "btc",
      period: "5m",
      periodSeries: alignBarSeries({
        pyth: [bar(0, 90, 100), bar(300_000, 100, 150), bar(600_000, 130, 135)],
        coinbase: [],
      }),
      oneMinuteSeries: alignBarSeries({
        pyth: [
          bar(300_000, 100, 105, 106, 99),
          bar(360_000, 105, 103, 108, 101),
          bar(420_000, 103, 112, 114, 102),
          bar(480_000, 112, 150, 151, 111),
        ],
        coinbase: [],
      }),
      hydrateBars: 3,
    });

    expect(series.pythSyntheticByTargetIndex[2]).toEqual({
      openTimeMs: 300_000,
      open: 100,
      high: 114,
      low: 99,
      close: 112,
      volume: 0,
    });
  });

  it("excludes the fully closed pre-target period bar from filter windows", () => {
    const series = createHistoricalDecisionSeries({
      asset: "btc",
      period: "5m",
      periodSeries: alignBarSeries({
        pyth: [bar(0, 90, 100), bar(300_000, 100, 150), bar(600_000, 130, 135)],
        coinbase: [],
      }),
      oneMinuteSeries: alignBarSeries({
        pyth: [
          bar(300_000, 100, 105),
          bar(360_000, 105, 103),
          bar(420_000, 103, 112),
        ],
        coinbase: [],
      }),
    });

    const window = selectHistoricalDecisionFilterWindow({
      series,
      filter: { barSource: "pyth" },
      targetIndex: 2,
      requiredBars: 2,
    });

    expect(window?.map((b) => [b.openTimeMs, b.open, b.close])).toEqual([
      [0, 90, 100],
      [300_000, 100, 112],
    ]);
  });

  it("skips the decision moment when required Pyth 1m candles are missing", () => {
    const series = createHistoricalDecisionSeries({
      asset: "btc",
      period: "5m",
      periodSeries: alignBarSeries({
        pyth: [bar(0, 90, 100), bar(300_000, 100, 150), bar(600_000, 130, 135)],
        coinbase: [],
      }),
      oneMinuteSeries: alignBarSeries({
        pyth: [bar(300_000, 100, 105), bar(420_000, 103, 112)],
        coinbase: [],
      }),
    });

    expect(
      buildHistoricalDecisionAlignedSeries({ series, targetIndex: 2 }),
    ).toBeNull();
  });

  it("keeps price filters alive but makes volume filters abstain when active Coinbase 1m is missing", () => {
    const series = createHistoricalDecisionSeries({
      asset: "btc",
      period: "5m",
      periodSeries: alignBarSeries({
        pyth: [bar(0, 90, 100), bar(300_000, 100, 150), bar(600_000, 130, 135)],
        coinbase: [bar(0, 90, 100), bar(300_000, 100, 150)],
      }),
      oneMinuteSeries: alignBarSeries({
        pyth: [
          bar(300_000, 100, 105),
          bar(360_000, 105, 103),
          bar(420_000, 103, 112),
        ],
        coinbase: [bar(300_000, 100, 105), bar(420_000, 103, 112)],
      }),
    });

    expect(
      selectHistoricalDecisionFilterWindow({
        series,
        filter: { barSource: "pyth" },
        targetIndex: 2,
        requiredBars: 1,
      })?.at(-1)?.close,
    ).toBe(112);
    expect(
      selectHistoricalDecisionFilterWindow({
        series,
        filter: { barSource: "coinbase" },
        targetIndex: 2,
        requiredBars: 1,
      }),
    ).toBeNull();
  });
});

function bar(
  openTimeMs: number,
  open: number,
  close: number,
  high = Math.max(open, close),
  low = Math.min(open, close),
): FilterBar {
  return {
    openTimeMs,
    open,
    high,
    low,
    close,
    volume: 0,
  };
}
