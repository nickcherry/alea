import {
  scanPolymarketTradingPerformance,
  type DataApiFetch,
  type TradingPerformanceScanProgress,
} from "@alea/lib/trading/vendor/polymarket/scanTradingPerformance";
import type { ClobClient } from "@polymarket/clob-client-v2";
import { describe, expect, it } from "bun:test";

function fakeClient({
  markets,
}: {
  readonly markets: ReadonlyMap<string, unknown>;
}): ClobClient {
  return {
    async getMarket(conditionId: string) {
      return markets.get(conditionId) ?? { tokens: [] };
    },
  } as unknown as ClobClient;
}

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
  it("fetches paginated data-api trades, resolves markets, and returns dashboard payload data", async () => {
    const progress: TradingPerformanceScanProgress[] = [];
    const payload = await scanPolymarketTradingPerformance({
      funderAddress: "0xfunder",
      generatedAtMs: 1_777_900_600_000,
      client: fakeClient({
        markets: new Map<string, unknown>([
          [
            "condition-1",
            {
              condition_id: "condition-1",
              question: "Bitcoin Up or Down - May 4, 12:00PM ET",
              market_slug: "btc-updown-5m-1777900200",
              end_date_iso: "2026-05-04T16:05:00.000Z",
              closed: true,
              tokens: [
                { token_id: "UP_TOKEN", outcome: "Up", price: 1, winner: true },
                {
                  token_id: "DOWN_TOKEN",
                  outcome: "Down",
                  price: 0,
                  winner: false,
                },
              ],
            },
          ],
        ]),
      }),
      dataApiFetch: fakeDataApiFetch({
        pages: [
          [
            {
              proxyWallet: "0xfunder",
              side: "BUY",
              asset: "UP_TOKEN",
              conditionId: "condition-1",
              size: 10,
              price: 0.4,
              timestamp: 1_777_900_220,
              outcome: "Up",
              transactionHash: "0xhash",
            },
          ],
          [],
        ],
      }),
      onProgress: (event) => progress.push(event),
    });

    expect(payload.summary.tradeCount).toBe(1);
    expect(payload.summary.lifetimePnlUsd).toBeCloseTo(6, 9);
    expect(payload.walletAddress).toBe("0xfunder");
    expect(payload.trades[0]).toMatchObject({
      id: "0xhash-0",
      symbol: "BTC",
      result: "win",
      traderSide: "UNKNOWN",
      feeUsd: 0,
      pnlUsd: 6,
    });
    expect(payload.chart).toHaveLength(1);
    expect(progress).toEqual([
      { kind: "trades-page", tradesSoFar: 1 },
      { kind: "markets-progress", resolved: 1, total: 1 },
    ]);
  });

  it("paginates by offset until the page comes back smaller than the page size", async () => {
    const progress: TradingPerformanceScanProgress[] = [];
    const fullPage = Array.from({ length: 500 }, (_, idx) => ({
      proxyWallet: "0xfunder",
      side: "BUY",
      asset: `tok-${idx}`,
      conditionId: `cond-${idx}`,
      size: 1,
      price: 0.5,
      timestamp: 1_700_000_000 + idx,
      outcome: "Up",
      transactionHash: `0x${idx.toString(16)}`,
    }));
    const partialPage = [
      {
        proxyWallet: "0xfunder",
        side: "SELL",
        asset: "tok-tail",
        conditionId: "cond-tail",
        size: 1,
        price: 0.5,
        timestamp: 1_700_001_000,
        outcome: "Down",
      },
    ];
    const payload = await scanPolymarketTradingPerformance({
      funderAddress: "0xfunder",
      generatedAtMs: 1_777_900_600_000,
      client: fakeClient({ markets: new Map() }),
      dataApiFetch: fakeDataApiFetch({ pages: [fullPage, partialPage] }),
      onProgress: (event) => progress.push(event),
    });
    expect(payload.summary.tradeCount).toBe(501);
    expect(progress.filter((e) => e.kind === "trades-page")).toEqual([
      { kind: "trades-page", tradesSoFar: 500 },
      { kind: "trades-page", tradesSoFar: 501 },
    ]);
  });
});
