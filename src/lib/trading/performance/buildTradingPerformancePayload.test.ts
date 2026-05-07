import {
  buildTradingPerformancePayload,
  type TradingPerformanceInputPosition,
} from "@alea/lib/trading/performance/buildTradingPerformancePayload";
import { describe, expect, it } from "bun:test";

function position(
  overrides: Partial<TradingPerformanceInputPosition> = {},
): TradingPerformanceInputPosition {
  return {
    conditionId: "0xcondition",
    tokenId: "TOKEN",
    oppositeTokenId: "OPPOSITE",
    title: "Bitcoin Up or Down - May 4, 12:00PM ET",
    slug: "btc-updown-5m-1777900200",
    outcome: "Up",
    size: 100,
    avgPrice: 0.3,
    currentPrice: 0,
    initialValueUsd: 30,
    currentValueUsd: 0,
    cashPnlUsd: -30,
    realizedPnlUsd: 0,
    endDateMs: Date.parse("2026-05-04T16:05:00Z"),
    redeemable: true,
    ...overrides,
  };
}

describe("buildTradingPerformancePayload", () => {
  it("aggregates position-level cashPnl into the lifetime summary", () => {
    const payload = buildTradingPerformancePayload({
      walletAddress: "0xfunder",
      generatedAtMs: 1_777_900_600_000,
      positions: [
        position({ conditionId: "win", cashPnlUsd: 70, currentValueUsd: 100 }),
        position({ conditionId: "loss", cashPnlUsd: -30 }),
        position({
          conditionId: "open",
          redeemable: false,
          cashPnlUsd: 5,
          currentValueUsd: 35,
          endDateMs: null,
        }),
      ],
    });

    expect(payload.summary.positionCount).toBe(3);
    expect(payload.summary.lifetimePnlUsd).toBeCloseTo(45, 9);
    expect(payload.summary.totalInvestedUsd).toBeCloseTo(90, 9);
    expect(payload.summary.currentValueUsd).toBeCloseTo(135, 9);
    expect(payload.summary.openPositionCount).toBe(1);
    expect(payload.summary.redeemablePositionCount).toBe(2);
    expect(payload.summary.winningPositionCount).toBe(1);
    expect(payload.summary.losingPositionCount).toBe(1);
    expect(payload.summary.flatPositionCount).toBe(0);
  });

  it("derives symbol, status, and result on each row and orders the chart by end date", () => {
    const payload = buildTradingPerformancePayload({
      walletAddress: "0xfunder",
      generatedAtMs: 1_777_900_600_000,
      positions: [
        position({
          conditionId: "later",
          slug: "eth-updown-5m-2",
          title: "Ethereum Up or Down - May 5",
          endDateMs: Date.parse("2026-05-05T00:00:00Z"),
          cashPnlUsd: 10,
        }),
        position({
          conditionId: "earlier",
          slug: "btc-updown-5m-1",
          endDateMs: Date.parse("2026-05-03T00:00:00Z"),
          cashPnlUsd: -5,
        }),
      ],
    });

    expect(payload.positions.map((row) => row.conditionId)).toEqual([
      "later",
      "earlier",
    ]);
    expect(payload.positions[0]?.symbol).toBe("ETH");
    expect(payload.positions[0]?.result).toBe("win");
    expect(payload.positions[1]?.symbol).toBe("BTC");
    expect(payload.positions[1]?.result).toBe("loss");

    expect(payload.chart.map((p) => p.cumulativePnlUsd)).toEqual([-5, 5]);
  });

  it("marks open positions with status open regardless of cashPnl sign", () => {
    const payload = buildTradingPerformancePayload({
      walletAddress: "0xfunder",
      generatedAtMs: 0,
      positions: [
        position({ redeemable: false, cashPnlUsd: 12 }),
      ],
    });
    expect(payload.positions[0]?.status).toBe("open");
    expect(payload.positions[0]?.result).toBe("open");
  });
});
