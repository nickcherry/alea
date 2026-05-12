import { resolutionTimeframeStepMs } from "@alea/lib/polymarket/enumerateWindowStarts";
import { discoverPolymarketMarket } from "@alea/lib/trading/vendor/polymarket/discoverMarket";
import type { TradableMarket } from "@alea/lib/trading/vendor/types";
import type { Asset } from "@alea/types/assets";
import type { ResolutionTimeframe } from "@alea/types/resolutions";

type DiscoverMarket = typeof discoverPolymarketMarket;

export type PolymarketMarketDiscoveryCache = {
  readonly warm: (input: {
    readonly assets: readonly Asset[];
    readonly timeframes: readonly ResolutionTimeframe[];
    readonly nowMs: number;
    readonly discoveryLeadMs: number;
  }) => void;
  readonly get: (input: MarketDiscoveryInput) => TradableMarket | null;
  readonly getOrDiscover: (
    input: MarketDiscoveryInput,
  ) => Promise<TradableMarket | null>;
};

type MarketDiscoveryInput = {
  readonly asset: Asset;
  readonly timeframe: ResolutionTimeframe;
  readonly windowStartTsMs: number;
};

export function createPolymarketMarketDiscoveryCache({
  discover = discoverPolymarketMarket,
  retryMs = 10_000,
  signal,
}: {
  readonly discover?: DiscoverMarket;
  readonly retryMs?: number;
  readonly signal?: AbortSignal;
} = {}): PolymarketMarketDiscoveryCache {
  const markets = new Map<string, TradableMarket>();
  const inflight = new Map<string, Promise<TradableMarket | null>>();
  const nextAttemptAt = new Map<string, number>();

  const get = (input: MarketDiscoveryInput): TradableMarket | null =>
    markets.get(marketKey(input)) ?? null;

  const getOrDiscover = async (
    input: MarketDiscoveryInput,
  ): Promise<TradableMarket | null> => {
    const key = marketKey(input);
    const existing = markets.get(key);
    if (existing !== undefined) {
      return existing;
    }

    const nowMs = Date.now();
    if ((nextAttemptAt.get(key) ?? 0) > nowMs) {
      return null;
    }

    const existingInflight = inflight.get(key);
    if (existingInflight !== undefined) {
      return existingInflight;
    }

    const promise = discover({
      asset: input.asset,
      timeframe: input.timeframe,
      windowStartUnixSeconds: Math.floor(input.windowStartTsMs / 1_000),
      signal,
    })
      .then((market) => {
        if (market !== null) {
          markets.set(key, market);
          nextAttemptAt.delete(key);
          return market;
        }
        nextAttemptAt.set(key, Date.now() + retryMs);
        return null;
      })
      .catch(() => {
        nextAttemptAt.set(key, Date.now() + retryMs);
        return null;
      })
      .finally(() => {
        inflight.delete(key);
      });

    inflight.set(key, promise);
    return promise;
  };

  const warm: PolymarketMarketDiscoveryCache["warm"] = ({
    assets,
    timeframes,
    nowMs,
    discoveryLeadMs,
  }) => {
    for (const timeframe of timeframes) {
      const stepMs = resolutionTimeframeStepMs({ timeframe });
      const currentStart = Math.floor(nowMs / stepMs) * stepMs;
      const nextStart = currentStart + stepMs;
      for (const asset of assets) {
        void getOrDiscover({ asset, timeframe, windowStartTsMs: currentStart });
        if (nowMs + discoveryLeadMs >= nextStart) {
          void getOrDiscover({ asset, timeframe, windowStartTsMs: nextStart });
        }
      }
    }
  };

  return { warm, get, getOrDiscover };
}

function marketKey({
  asset,
  timeframe,
  windowStartTsMs,
}: MarketDiscoveryInput): string {
  return `${asset}:${timeframe}:${windowStartTsMs}`;
}
