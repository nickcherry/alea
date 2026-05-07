import { renderTradingPerformanceHtml } from "@alea/lib/trading/performance/renderTradingPerformanceHtml";
import type { TradingPerformancePayload } from "@alea/lib/trading/performance/types";
import { describe, expect, it } from "bun:test";

describe("renderTradingPerformanceHtml", () => {
  it("renders the Alea shell, PnL chart host, and positions table", () => {
    const html = renderTradingPerformanceHtml({
      payload: payloadFixture(),
      assets: { stylesheets: [], scripts: [] },
    });

    expect(html).toContain("Polymarket Trading Performance");
    expect(html).toContain("https://cdn.jsdelivr.net/npm/uplot@1.6.30");
    expect(html).toContain('id="pnl-chart"');
    expect(html).toContain("BTC");
    expect(html).toContain("Bitcoin Up or Down");
    expect(html).toContain("-$30.00");
    expect(html).toContain("Polymarket data-api");
    expect(html).toContain("Current Value");
  });
});

function payloadFixture(): TradingPerformancePayload {
  return {
    command: "trading:performance",
    generatedAtMs: 1_777_900_600_000,
    walletAddress: "0x1234567890abcdef1234567890abcdef12345678",
    source: {
      positions: "Polymarket data-api /positions?user=<funder>",
    },
    summary: {
      walletAddress: "0x1234567890abcdef1234567890abcdef12345678",
      positionCount: 1,
      openPositionCount: 0,
      redeemablePositionCount: 1,
      winningPositionCount: 0,
      losingPositionCount: 1,
      flatPositionCount: 0,
      lifetimePnlUsd: -30,
      totalInvestedUsd: 30,
      currentValueUsd: 0,
    },
    chart: [
      {
        conditionId: "condition-1",
        symbol: "BTC",
        title: "Bitcoin Up or Down",
        orderedAtMs: 1_777_900_500_000,
        positionPnlUsd: -30,
        cumulativePnlUsd: -30,
      },
    ],
    positions: [
      {
        conditionId: "condition-1",
        tokenId: "UP",
        oppositeTokenId: "DOWN",
        symbol: "BTC",
        title: "Bitcoin Up or Down",
        slug: "btc-updown-5m-1777900200",
        outcome: "Up",
        size: 100,
        avgPrice: 0.3,
        currentPrice: 0,
        initialValueUsd: 30,
        currentValueUsd: 0,
        cashPnlUsd: -30,
        realizedPnlUsd: 0,
        endDateMs: 1_777_900_500_000,
        status: "redeemable",
        result: "loss",
      },
    ],
  };
}
