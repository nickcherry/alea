export type MarketBar = {
  readonly openTimeMs: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
};

export type MarketBarSource = "pyth" | "coinbase";

export type AlignedMarketSeries = {
  readonly pyth: readonly MarketBar[];
  readonly coinbase: readonly (MarketBar | null)[];
};
