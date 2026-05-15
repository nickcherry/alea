import {
  filterCandlesForChartWindow,
  marketChartCandleWindow,
} from "@alea/lib/candles/chart/fetchMarketChartCandles";
import { marketChartPayload } from "@alea/lib/candles/chart/renderMarketChartImage";
import type { Candle } from "@alea/types/candles";
import { describe, expect, it } from "bun:test";

describe("market chart helpers", () => {
  it("aligns the requested window to completed timeframe boundaries", () => {
    const window = marketChartCandleWindow({
      timeframe: "5m",
      bars: 12,
      end: new Date("2026-05-15T12:17:33.000Z"),
    });

    expect(window.start.toISOString()).toBe("2026-05-15T11:15:00.000Z");
    expect(window.end.toISOString()).toBe("2026-05-15T12:15:00.000Z");
    expect(window.mode).toBe("recent");
  });

  it("aligns an explicit chart time range", () => {
    const window = marketChartCandleWindow({
      timeframe: "15m",
      start: new Date("2026-05-15T09:37:00.000Z"),
      end: new Date("2026-05-15T13:44:00.000Z"),
    });

    expect(window.start.toISOString()).toBe("2026-05-15T09:30:00.000Z");
    expect(window.end.toISOString()).toBe("2026-05-15T13:30:00.000Z");
    expect(window.mode).toBe("range");
  });

  it("treats the chart end as an exclusive cutoff", () => {
    const candles = filterCandlesForChartWindow({
      window: {
        start: new Date("2026-05-15T09:30:00.000Z"),
        end: new Date("2026-05-15T10:30:00.000Z"),
        mode: "range",
      },
      candles: [
        candle({ timestamp: "2026-05-15T09:25:00.000Z" }),
        candle({ timestamp: "2026-05-15T09:30:00.000Z" }),
        candle({ timestamp: "2026-05-15T10:25:00.000Z" }),
        candle({ timestamp: "2026-05-15T10:30:00.000Z" }),
      ],
    });

    expect(candles.map((c) => c.timestamp.toISOString())).toEqual([
      "2026-05-15T09:30:00.000Z",
      "2026-05-15T10:25:00.000Z",
    ]);
  });

  it("builds lightweight chart candle and volume series", () => {
    const payload = marketChartPayload({
      candles: [
        candle({
          timestamp: "2026-05-15T12:00:00.000Z",
          open: 100,
          high: 103,
          low: 99,
          close: 102,
          volume: 10,
        }),
        candle({
          timestamp: "2026-05-15T12:05:00.000Z",
          open: 102,
          high: 104,
          low: 101,
          close: 101,
          volume: 12,
        }),
      ],
      asset: "btc",
      source: "coinbase",
      product: "spot",
      timeframe: "5m",
      width: 1600,
      height: 900,
    });

    expect(payload.title).toBe("BTC-USD 5m");
    expect(payload.subtitle).toBe("Coinbase spot");
    expect(payload.candles).toEqual([
      { time: 1778846400, open: 100, high: 103, low: 99, close: 102 },
      { time: 1778846700, open: 102, high: 104, low: 101, close: 101 },
    ]);
    expect(payload.volume.map((bar) => bar.value)).toEqual([10, 12]);
    expect(payload.showPriceLine).toBe(true);
    expect(payload.showTopInfo).toBe(true);
    expect(payload.latestLabel).toContain("-0.98%");
  });

  it("can disable future-state chart overlays for visual replay", () => {
    const payload = marketChartPayload({
      candles: [
        candle({
          timestamp: "2026-05-15T12:00:00.000Z",
          open: 100,
          high: 103,
          low: 99,
          close: 102,
          volume: 10,
        }),
      ],
      asset: "btc",
      source: "coinbase",
      product: "spot",
      timeframe: "5m",
      width: 1600,
      height: 900,
      showPriceLine: false,
      showTopInfo: false,
    });

    expect(payload.showPriceLine).toBe(false);
    expect(payload.showTopInfo).toBe(false);
  });
});

function candle({
  timestamp,
  open = 100,
  high = 103,
  low = 99,
  close = 102,
  volume = 10,
}: {
  readonly timestamp: string;
  readonly open?: number;
  readonly high?: number;
  readonly low?: number;
  readonly close?: number;
  readonly volume?: number;
}): Candle {
  return {
    source: "coinbase",
    asset: "btc",
    product: "spot",
    timeframe: "5m",
    timestamp: new Date(timestamp),
    open,
    high,
    low,
    close,
    volume,
  };
}
