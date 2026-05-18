import { renderTradingPerformanceHtml } from "@alea/lib/trading/performance/renderTradingPerformanceHtml";
import type { TradingPerformancePayload } from "@alea/lib/trading/performance/types";
import { describe, expect, it } from "bun:test";

describe("renderTradingPerformanceHtml", () => {
  it("renders the Alea shell, PnL chart host, and markets table", () => {
    const html = renderTradingPerformanceHtml({
      payload: payloadFixture(),
      assets: { stylesheets: [], scripts: [] },
    });

    expect(html).toContain("Polymarket Trading Performance");
    expect(html).toContain("https://cdn.jsdelivr.net/npm/uplot@1.6.30");
    expect(html).toContain('id="pnl-chart"');
    expect(html).toContain("BTC");
    expect(html).toContain("Bitcoin Up or Down");
    expect(html).toContain("-$25.00");
    expect(html).toContain("Polymarket data-api");
    expect(html).toContain("Total Fees");
    expect(html).toContain("Cumulative Realized PnL");
    expect(html).toContain("MTM");
    expect(html).toContain("50.0c");
  });
});

function payloadFixture(): TradingPerformancePayload {
  return {
    command: "trading:performance",
    generatedAtMs: 1_777_900_600_000,
    walletAddress: "0x1234567890abcdef1234567890abcdef12345678",
    source: {
      activity: "Polymarket data-api /activity",
      positions: "Polymarket data-api /positions",
    },
    summary: {
      walletAddress: "0x1234567890abcdef1234567890abcdef12345678",
      marketCount: 1,
      openPositionCount: 0,
      redeemablePositionCount: 1,
      winningMarketCount: 0,
      losingMarketCount: 1,
      flatMarketCount: 0,
      lifetimePnlUsd: -25,
      realizedPnlUsd: -25,
      openMtmPnlUsd: 0,
      totalInvestedUsd: 25,
      totalReturnedUsd: 0,
      currentValueUsd: 0,
      makerRebateUsd: 0,
      totalFeesUsd: 1.25,
    },
    chart: [
      {
        conditionId: "condition-1",
        symbol: "BTC",
        title: "Bitcoin Up or Down",
        orderedAtMs: 1_777_900_500_000,
        marketPnlUsd: -25,
        cumulativePnlUsd: -25,
      },
    ],
    markets: [
      {
        conditionId: "condition-1",
        symbol: "BTC",
        title: "Bitcoin Up or Down",
        slug: "bitcoin-up-or-down-may-17-2026-4pm-et",
        outcome: "Up",
        endDateMs: 1_777_900_500_000,
        lastActivityAtMs: 1_777_900_500_000,
        investedUsd: 25,
        returnedUsd: 0,
        currentValueUsd: 0,
        currentSize: 100,
        currentPrice: 0,
        boughtSize: 50,
        avgEntryPrice: 0.5,
        realizedPnlUsd: -25,
        pnlUsd: -25,
        status: "redeemable",
        result: "loss",
        traderRole: "taker",
        feeUsd: 1.25,
      },
    ],
  };
}
