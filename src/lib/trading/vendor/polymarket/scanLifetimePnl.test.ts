import { scanPolymarketLifetimePnl } from "@alea/lib/trading/vendor/polymarket/scanLifetimePnl";
import type { DataApiFetch } from "@alea/lib/trading/vendor/polymarket/scanTradingPerformance";
import type { LifetimePnlScanProgress } from "@alea/lib/trading/vendor/types";
import { describe, expect, it } from "bun:test";

function fetchWith({
  responses,
}: {
  readonly responses: ReadonlyMap<string, unknown>;
}): DataApiFetch {
  return async (url) => ({
    ok: true,
    status: 200,
    json: async () => {
      for (const [key, body] of responses) {
        if (url.includes(key)) {
          return body;
        }
      }
      return [];
    },
  });
}

describe("scanPolymarketLifetimePnl", () => {
  it("delegates to the dashboard data-api scan and projects its summary", async () => {
    const progress: LifetimePnlScanProgress[] = [];
    const result = await scanPolymarketLifetimePnl({
      funderAddress: "0xFUNDER",
      onProgress: (event) => progress.push(event),
      dataApiFetch: fetchWith({
        responses: new Map<string, unknown>([
          [
            "/activity",
            [
              {
                type: "TRADE",
                side: "BUY",
                conditionId: "condition-1",
                title: "Bitcoin Up or Down",
                slug: "btc",
                outcome: "Up",
                usdcSize: 25,
                timestamp: 1_777_900_000,
              },
              {
                type: "REDEEM",
                conditionId: "condition-1",
                title: "Bitcoin Up or Down",
                slug: "btc",
                outcome: "Up",
                usdcSize: 30,
                timestamp: 1_777_900_500,
              },
            ],
          ],
          ["/positions", []],
        ]),
      }),
    });

    expect(result.lifetimePnlUsd).toBeCloseTo(5, 9);
    expect(result.marketCount).toBe(1);
    expect(result.openPositionCount).toBe(0);
    expect(progress.some((event) => event.kind === "activity-page")).toBe(true);
  });
});
