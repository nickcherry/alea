import {
  type DataApiFetch,
  type PolymarketRawActivity,
  scanPolymarketTradingPerformance,
  type TradingPerformanceScanProgress,
} from "@alea/lib/trading/vendor/polymarket/scanTradingPerformance";
import { describe, expect, it } from "bun:test";

function fakeDataApiFetch({
  activityPages,
  positionsPages,
}: {
  readonly activityPages: readonly (readonly unknown[])[];
  readonly positionsPages: readonly (readonly unknown[])[];
}): DataApiFetch {
  let activityIdx = 0;
  let positionsIdx = 0;
  return async (url) => {
    const isActivity = url.includes("/activity?");
    const isPositions = url.includes("/positions?");
    let page: readonly unknown[] = [];
    if (isActivity) {
      page = activityPages[activityIdx] ?? [];
      activityIdx += 1;
    } else if (isPositions) {
      expect(url).toContain("sizeThreshold=0");
      page = positionsPages[positionsIdx] ?? [];
      positionsIdx += 1;
    } else {
      throw new Error(`unexpected URL: ${url}`);
    }
    return {
      ok: true,
      status: 200,
      json: async () => page,
    };
  };
}

describe("scanPolymarketTradingPerformance", () => {
  it("computes lifetime PnL from /activity cashflows + /positions mark-to-market", async () => {
    const progress: TradingPerformanceScanProgress[] = [];
    const { payload } = await scanPolymarketTradingPerformance({
      funderAddress: "0xfunder",
      generatedAtMs: 1_777_900_600_000,
      dataApiFetch: fakeDataApiFetch({
        activityPages: [
          [
            // Won: paid $10, redeemed for $25 → +$15
            {
              type: "TRADE",
              side: "BUY",
              conditionId: "win",
              title: "BTC Up",
              slug: "btc-updown-5m-1",
              outcome: "Up",
              usdcSize: 10,
              timestamp: 1_777_900_000,
            },
            {
              type: "REDEEM",
              conditionId: "win",
              title: "BTC Up",
              slug: "btc-updown-5m-1",
              outcome: "Up",
              usdcSize: 25,
              timestamp: 1_777_900_500,
            },
            // Lost: paid $50, never redeemed (still in /positions)
            {
              type: "TRADE",
              side: "BUY",
              conditionId: "lose",
              title: "ETH Up",
              slug: "eth-updown-5m-2",
              outcome: "Up",
              usdcSize: 50,
              timestamp: 1_777_800_000,
            },
            // Maker rebate not attributed to any market
            {
              type: "MAKER_REBATE",
              usdcSize: 1.5,
              timestamp: 1_777_900_700,
            },
          ],
          [],
        ],
        positionsPages: [
          [
            {
              conditionId: "lose",
              title: "ETH Up",
              slug: "eth-updown-5m-2",
              outcome: "Up",
              size: 100,
              curPrice: 0,
              currentValue: 0,
              endDate: "2026-05-01",
              redeemable: true,
            },
          ],
          [],
        ],
      }),
      onProgress: (event) => progress.push(event),
    });

    // 25 - 10 (win) + 0 - 50 (loss) + 1.5 rebate = -33.5
    expect(payload.summary.lifetimePnlUsd).toBeCloseTo(-33.5, 9);
    expect(payload.summary.totalInvestedUsd).toBeCloseTo(60, 9);
    expect(payload.summary.totalReturnedUsd).toBeCloseTo(25, 9);
    expect(payload.summary.currentValueUsd).toBeCloseTo(0, 9);
    expect(payload.summary.makerRebateUsd).toBeCloseTo(1.5, 9);
    expect(payload.summary.marketCount).toBe(2);
    expect(payload.summary.winningMarketCount).toBe(1);
    expect(payload.summary.losingMarketCount).toBe(1);
    expect(payload.summary.redeemablePositionCount).toBe(0);
    expect(payload.walletAddress).toBe("0xfunder");
    expect(progress).toEqual([
      { kind: "activity-page", activitiesSoFar: 4 },
      { kind: "positions-page", positionsSoFar: 1 },
    ]);
  });

  it("overlaps and dedupes the activity cache boundary", async () => {
    const cached: PolymarketRawActivity = {
      type: "TRADE",
      side: "BUY",
      conditionId: "cached",
      title: "BTC Up",
      slug: "btc-updown-5m-cached",
      outcome: "Up",
      usdcSize: 10,
      timestamp: 1_000,
    };

    const { mergedActivity } = await scanPolymarketTradingPerformance({
      funderAddress: "0xfunder",
      generatedAtMs: 1_777_900_600_000,
      existingActivity: [cached],
      dataApiFetch: fakeDataApiFetch({
        activityPages: [
          [
            {
              type: "TRADE",
              side: "BUY",
              conditionId: "newer",
              title: "ETH Up",
              slug: "eth-updown-5m-newer",
              outcome: "Up",
              usdcSize: 20,
              timestamp: 1_010,
            },
            cached,
            {
              type: "REDEEM",
              conditionId: "late-same-second",
              title: "SOL Up",
              slug: "sol-updown-5m-late",
              outcome: "Up",
              usdcSize: 5,
              timestamp: 1_000,
            },
            {
              type: "TRADE",
              side: "BUY",
              conditionId: "before-overlap",
              title: "DOGE Up",
              slug: "doge-updown-5m-old",
              outcome: "Up",
              usdcSize: 5,
              timestamp: 699,
            },
          ],
        ],
        positionsPages: [[]],
      }),
    });

    expect(mergedActivity.map((row) => row.conditionId)).toEqual([
      "newer",
      "cached",
      "late-same-second",
    ]);
  });
});
