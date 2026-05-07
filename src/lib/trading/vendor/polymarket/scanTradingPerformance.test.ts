import {
  scanPolymarketTradingPerformance,
  type DataApiFetch,
  type TradingPerformanceScanProgress,
} from "@alea/lib/trading/vendor/polymarket/scanTradingPerformance";
import { describe, expect, it } from "bun:test";

function fakeDataApiFetch({
  pages,
}: {
  readonly pages: readonly (readonly unknown[])[];
}): DataApiFetch {
  let pageIndex = 0;
  return async (url) => {
    const offsetMatch = /offset=(\d+)/.exec(url);
    const offset =
      offsetMatch?.[1] !== undefined ? Number(offsetMatch[1]) : 0;
    expect(offset).toBe(pageIndex * 500);
    expect(url).toContain("sizeThreshold=0");
    const page = pages[pageIndex] ?? [];
    pageIndex += 1;
    return {
      ok: true,
      status: 200,
      json: async () => page,
    };
  };
}

describe("scanPolymarketTradingPerformance", () => {
  it("fetches paginated /positions and produces a position-based payload", async () => {
    const progress: TradingPerformanceScanProgress[] = [];
    const payload = await scanPolymarketTradingPerformance({
      funderAddress: "0xfunder",
      generatedAtMs: 1_777_900_600_000,
      dataApiFetch: fakeDataApiFetch({
        pages: [
          [
            {
              conditionId: "cond-loss",
              asset: "ASSET_LOSS",
              oppositeAsset: "OPPOSITE_LOSS",
              title: "Bitcoin Up or Down - May 4",
              slug: "btc-updown-5m-1",
              outcome: "Up",
              size: 100,
              avgPrice: 0.3,
              curPrice: 0,
              initialValue: 30,
              currentValue: 0,
              cashPnl: -30,
              realizedPnl: 0,
              endDate: "2026-05-04",
              redeemable: true,
            },
            {
              conditionId: "cond-open",
              asset: "ASSET_OPEN",
              title: "Ethereum Up or Down - May 7",
              slug: "eth-updown-5m-2",
              outcome: "Down",
              size: 50,
              avgPrice: 0.5,
              curPrice: 0.6,
              initialValue: 25,
              currentValue: 30,
              cashPnl: 5,
              endDate: "2026-05-07",
              redeemable: false,
            },
          ],
          [],
        ],
      }),
      onProgress: (event) => progress.push(event),
    });

    expect(payload.summary.positionCount).toBe(2);
    expect(payload.summary.lifetimePnlUsd).toBeCloseTo(-25, 9);
    expect(payload.summary.totalInvestedUsd).toBeCloseTo(55, 9);
    expect(payload.summary.currentValueUsd).toBeCloseTo(30, 9);
    expect(payload.summary.openPositionCount).toBe(1);
    expect(payload.summary.redeemablePositionCount).toBe(1);
    expect(payload.summary.losingPositionCount).toBe(1);
    expect(payload.walletAddress).toBe("0xfunder");
    expect(payload.positions.find((p) => p.conditionId === "cond-loss")).toMatchObject({
      symbol: "BTC",
      result: "loss",
      status: "redeemable",
      cashPnlUsd: -30,
    });
    expect(payload.positions.find((p) => p.conditionId === "cond-open")).toMatchObject({
      symbol: "ETH",
      result: "open",
      status: "open",
    });
    expect(progress).toEqual([{ kind: "positions-page", positionsSoFar: 2 }]);
  });

  it("paginates by offset until the page comes back smaller than the page size", async () => {
    const fullPage = Array.from({ length: 500 }, (_, idx) => ({
      conditionId: `cond-${idx}`,
      asset: `tok-${idx}`,
      title: `M${idx}`,
      slug: "btc-updown",
      outcome: "Up",
      size: 1,
      avgPrice: 0.5,
      curPrice: 0,
      initialValue: 0.5,
      currentValue: 0,
      cashPnl: -0.5,
      redeemable: true,
    }));
    const partialPage = [
      {
        conditionId: "cond-tail",
        asset: "tok-tail",
        title: "Tail",
        slug: "btc-updown",
        outcome: "Up",
        size: 1,
        avgPrice: 0.5,
        curPrice: 0,
        initialValue: 0.5,
        currentValue: 0,
        cashPnl: -0.5,
        redeemable: true,
      },
    ];
    const payload = await scanPolymarketTradingPerformance({
      funderAddress: "0xfunder",
      generatedAtMs: 0,
      dataApiFetch: fakeDataApiFetch({ pages: [fullPage, partialPage] }),
    });
    expect(payload.summary.positionCount).toBe(501);
    expect(payload.summary.lifetimePnlUsd).toBeCloseTo(-250.5, 9);
  });
});
