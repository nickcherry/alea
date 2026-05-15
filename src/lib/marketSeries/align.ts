import type {
  AlignedMarketSeries,
  MarketBar,
} from "@alea/lib/marketSeries/types";

export type { AlignedMarketSeries } from "@alea/lib/marketSeries/types";

export function alignMarketSeries({
  pyth,
  coinbase,
}: {
  readonly pyth: readonly MarketBar[];
  readonly coinbase: readonly MarketBar[];
}): AlignedMarketSeries {
  const coinbaseByOpenTime = new Map<number, MarketBar>();
  for (const bar of coinbase) {
    coinbaseByOpenTime.set(bar.openTimeMs, bar);
  }

  return {
    pyth,
    coinbase: pyth.map(
      (bar) => coinbaseByOpenTime.get(bar.openTimeMs) ?? null,
    ),
  };
}
