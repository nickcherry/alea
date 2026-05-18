import { createPolymarketMarketDiscoveryCache } from "@alea/lib/trading/vendor/polymarket/marketDiscoveryCache";
import type { TradableMarket } from "@alea/lib/trading/vendor/types";
import { describe, expect, it } from "bun:test";

const market: TradableMarket = {
  asset: "btc",
  vendorRef: "condition",
  upRef: "UP",
  downRef: "DOWN",
};

describe("createPolymarketMarketDiscoveryCache", () => {
  it("deduplicates concurrent discovery requests and caches the result", async () => {
    let calls = 0;
    const cache = createPolymarketMarketDiscoveryCache({
      discover: async () => {
        calls += 1;
        return market;
      },
    });

    const [a, b] = await Promise.all([
      cache.getOrDiscover({
        asset: "btc",
        timeframe: "1h",
        windowStartTsMs: 1_800_000_000_000,
      }),
      cache.getOrDiscover({
        asset: "btc",
        timeframe: "1h",
        windowStartTsMs: 1_800_000_000_000,
      }),
    ]);

    expect(a).toEqual(market);
    expect(b).toEqual(market);
    expect(calls).toBe(1);
    expect(
      cache.get({
        asset: "btc",
        timeframe: "1h",
        windowStartTsMs: 1_800_000_000_000,
      }),
    ).toEqual(market);
  });

  it("warms current and next windows when inside discovery lead", async () => {
    const seen: string[] = [];
    const cache = createPolymarketMarketDiscoveryCache({
      discover: async ({ asset, timeframe, windowStartUnixSeconds }) => {
        seen.push(`${asset}:${timeframe}:${windowStartUnixSeconds}`);
        return market;
      },
    });

    cache.warm({
      markets: [{ asset: "btc", timeframe: "1h" }],
      nowMs: 1_800_003_596_000,
      discoveryLeadMs: 30_000,
    });

    await Promise.resolve();

    expect(seen).toEqual(["btc:1h:1800000000", "btc:1h:1800003600"]);
  });

  it("backs off repeated misses instead of rediscovering immediately", async () => {
    let calls = 0;
    const cache = createPolymarketMarketDiscoveryCache({
      retryMs: 1_000,
      discover: async () => {
        calls += 1;
        return null;
      },
    });
    const input = {
      asset: "btc" as const,
      timeframe: "1h" as const,
      windowStartTsMs: 1_800_000_000_000,
    };

    expect(await cache.getOrDiscover(input)).toBeNull();
    expect(await cache.getOrDiscover(input)).toBeNull();
    expect(calls).toBe(1);
  });
});
