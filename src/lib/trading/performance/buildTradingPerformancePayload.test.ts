import {
  buildTradingPerformancePayload,
  type TradingPerformanceInputActivity,
} from "@alea/lib/trading/performance/buildTradingPerformancePayload";
import { describe, expect, it } from "bun:test";

function buy(
  overrides: Partial<TradingPerformanceInputActivity> = {},
): TradingPerformanceInputActivity {
  return {
    kind: "TRADE",
    side: "BUY",
    conditionId: "cond",
    title: "BTC Up",
    slug: "btc-updown-5m",
    outcome: "Up",
    usdcSize: 10,
    size: 0,
    price: 0,
    timestampMs: 1_777_900_000_000,
    ...overrides,
  };
}

function redeem(
  overrides: Partial<TradingPerformanceInputActivity> = {},
): TradingPerformanceInputActivity {
  return {
    kind: "REDEEM",
    side: null,
    conditionId: "cond",
    title: "BTC Up",
    slug: "btc-updown-5m",
    outcome: "Up",
    usdcSize: 25,
    size: 0,
    price: 0,
    timestampMs: 1_777_900_000_000,
    ...overrides,
  };
}

describe("buildTradingPerformancePayload", () => {
  it("rolls a winning closed market up to realized PnL = redeem - buy", () => {
    const payload = buildTradingPerformancePayload({
      walletAddress: "0xfunder",
      generatedAtMs: 0,
      activity: [
        buy({ conditionId: "win", usdcSize: 10 }),
        redeem({ conditionId: "win", usdcSize: 25 }),
      ],
      positions: [],
    });
    expect(payload.summary.lifetimePnlUsd).toBeCloseTo(15, 9);
    expect(payload.summary.realizedPnlUsd).toBeCloseTo(15, 9);
    expect(payload.summary.openMtmPnlUsd).toBeCloseTo(0, 9);
    expect(payload.summary.totalInvestedUsd).toBeCloseTo(10, 9);
    expect(payload.summary.totalReturnedUsd).toBeCloseTo(25, 9);
    expect(payload.markets[0]?.realizedPnlUsd).toBeCloseTo(15, 9);
    expect(payload.markets[0]?.result).toBe("win");
    expect(payload.markets[0]?.status).toBe("closed");
  });

  it("rolls a losing redeemable market up to PnL = -invested when /positions still holds it", () => {
    const payload = buildTradingPerformancePayload({
      walletAddress: "0xfunder",
      generatedAtMs: 0,
      activity: [buy({ conditionId: "lose", usdcSize: 50 })],
      positions: [
        {
          conditionId: "lose",
          title: "BTC Up",
          slug: "btc-updown-5m",
          outcome: "Up",
          size: 100,
          currentPrice: 0,
          currentValueUsd: 0,
          endDateMs: 1_777_900_000_000,
          redeemable: true,
        },
      ],
    });
    expect(payload.summary.lifetimePnlUsd).toBeCloseTo(-50, 9);
    // Dust-valued redeemable positions are demoted to "closed" so the
    // row reads as a plain loss, not "redeemable loss".
    expect(payload.markets[0]?.status).toBe("closed");
    expect(payload.markets[0]?.result).toBe("loss");
  });

  it("keeps redeemable status when the position still holds non-dust value (unclaimed winnings)", () => {
    const payload = buildTradingPerformancePayload({
      walletAddress: "0xfunder",
      generatedAtMs: 0,
      activity: [buy({ conditionId: "win", usdcSize: 10 })],
      positions: [
        {
          conditionId: "win",
          title: "BTC Up",
          slug: "btc-updown-5m",
          outcome: "Up",
          size: 100,
          currentPrice: 1,
          currentValueUsd: 100,
          endDateMs: 1_777_900_000_000,
          redeemable: true,
        },
      ],
    });
    expect(payload.markets[0]?.status).toBe("redeemable");
    expect(payload.markets[0]?.result).toBe("win");
  });

  it("includes mark-to-market value of currently-open positions", () => {
    const payload = buildTradingPerformancePayload({
      walletAddress: "0xfunder",
      generatedAtMs: 0,
      activity: [buy({ conditionId: "open", usdcSize: 30 })],
      positions: [
        {
          conditionId: "open",
          title: "BTC Up",
          slug: "btc-updown-5m",
          outcome: "Up",
          size: 100,
          currentPrice: 0.45,
          currentValueUsd: 45,
          endDateMs: null,
          redeemable: false,
        },
      ],
    });
    expect(payload.summary.lifetimePnlUsd).toBeCloseTo(15, 9);
    expect(payload.summary.realizedPnlUsd).toBeCloseTo(0, 9);
    expect(payload.summary.openMtmPnlUsd).toBeCloseTo(15, 9);
    expect(payload.markets[0]?.status).toBe("open");
    expect(payload.markets[0]?.result).toBe("open");
    expect(payload.markets[0]?.realizedPnlUsd).toBeNull();
    expect(payload.chart).toHaveLength(0);
  });

  it("counts MAKER_REBATE income but does not attach it to any market", () => {
    const payload = buildTradingPerformancePayload({
      walletAddress: "0xfunder",
      generatedAtMs: 0,
      activity: [
        buy({ conditionId: "a", usdcSize: 100 }),
        redeem({ conditionId: "a", usdcSize: 80 }),
        {
          kind: "MAKER_REBATE",
          side: null,
          conditionId: null,
          title: null,
          slug: null,
          outcome: null,
          usdcSize: 5,
          size: 0,
          price: 0,
          timestampMs: 0,
        },
      ],
      positions: [],
    });
    expect(payload.summary.makerRebateUsd).toBeCloseTo(5, 9);
    expect(payload.summary.lifetimePnlUsd).toBeCloseTo(-15, 9);
    expect(payload.markets).toHaveLength(1);
  });

  it("orders the chart by latest settled activity and produces cumulative realized PnL", () => {
    const payload = buildTradingPerformancePayload({
      walletAddress: "0xfunder",
      generatedAtMs: 0,
      activity: [
        buy({ conditionId: "first", usdcSize: 10, timestampMs: 1_000_000 }),
        redeem({ conditionId: "first", usdcSize: 25, timestampMs: 1_000_500 }),
        buy({ conditionId: "second", usdcSize: 5, timestampMs: 2_000_000 }),
        redeem({ conditionId: "second", usdcSize: 0, timestampMs: 2_000_500 }),
      ],
      positions: [],
    });
    expect(payload.chart.map((p) => p.cumulativePnlUsd)).toEqual([15, 10]);
  });

  it("keeps positive open mark-to-market out of realized win counts and chart", () => {
    const payload = buildTradingPerformancePayload({
      walletAddress: "0xfunder",
      generatedAtMs: 0,
      activity: [
        buy({
          conditionId: "open",
          usdcSize: 20,
          size: 38.46,
          price: 0.52,
        }),
      ],
      positions: [
        {
          conditionId: "open",
          title: "XRP Up",
          slug: "xrp-updown-15m",
          outcome: "Up",
          size: 38.46,
          currentPrice: 0.74,
          currentValueUsd: 28.4604,
          endDateMs: 1_777_900_000_000,
          redeemable: false,
        },
      ],
    });

    expect(payload.summary.winningMarketCount).toBe(0);
    expect(payload.summary.openPositionCount).toBe(1);
    expect(payload.summary.lifetimePnlUsd).toBeCloseTo(8.4604, 9);
    expect(payload.summary.realizedPnlUsd).toBeCloseTo(0, 9);
    expect(payload.summary.openMtmPnlUsd).toBeCloseTo(8.4604, 9);
    expect(payload.markets[0]?.avgEntryPrice).toBeCloseTo(20 / 38.46, 9);
    expect(payload.markets[0]?.realizedPnlUsd).toBeNull();
    expect(payload.markets[0]?.result).toBe("open");
    expect(payload.chart).toHaveLength(0);
  });
});
