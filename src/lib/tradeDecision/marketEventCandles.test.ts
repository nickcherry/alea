import { mergeStoredAndEventCandles } from "@alea/lib/tradeDecision/marketEventCandles";
import type { Candle } from "@alea/types/candles";
import { describe, expect, it } from "bun:test";

describe("mergeStoredAndEventCandles", () => {
  it("uses stored candles for history and lets live event bars override overlaps", () => {
    const merged = mergeStoredAndEventCandles({
      stored: [
        candle({ timestamp: "2026-05-15T12:00:00.000Z", close: 100 }),
        candle({ timestamp: "2026-05-15T12:05:00.000Z", close: 101 }),
      ],
      events: [
        candle({ timestamp: "2026-05-15T12:05:00.000Z", close: 111 }),
        candle({ timestamp: "2026-05-15T12:10:00.000Z", close: 112 }),
      ],
    });

    expect(
      merged.map((c) => [c.timestamp.toISOString(), c.close]),
    ).toEqual([
      ["2026-05-15T12:00:00.000Z", 100],
      ["2026-05-15T12:05:00.000Z", 111],
      ["2026-05-15T12:10:00.000Z", 112],
    ]);
  });
});

function candle({
  timestamp,
  close,
}: {
  readonly timestamp: string;
  readonly close: number;
}): Candle {
  return {
    source: "pyth",
    asset: "btc",
    product: "spot",
    timeframe: "1h",
    timestamp: new Date(timestamp),
    open: close,
    high: close,
    low: close,
    close,
    volume: 0,
  };
}
