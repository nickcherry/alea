import {
  TRADE_DECISION_CANDLE_FETCH_TIMEOUT_MS,
  TRADE_DECISION_HYDRATE_BARS,
  TRADE_DECISION_MAX_PRICE_AGE_MS,
  TRADE_DECISION_REFRESH_LOOKBACK_BARS,
  type TradeDecisionPeriod,
} from "@alea/constants/tradeDecision";
import { fetchCoinbaseCandles } from "@alea/lib/candles/sources/coinbase/fetchCoinbaseCandles";
import { fetchPythCandles } from "@alea/lib/candles/sources/pyth/fetchPythCandles";
import {
  alignBarSeries,
  type AlignedBarSeries,
} from "@alea/lib/filters/barSeries";
import type { FilterBar } from "@alea/lib/filters/types";
import {
  fetchLatestPythPrices,
  type LatestPythPrice,
} from "@alea/lib/livePrices/pyth/fetchLatestPythPrices";
import { resolutionTimeframeStepMs } from "@alea/lib/polymarket/enumerateWindowStarts";
import type { Asset } from "@alea/types/assets";
import type { Candle } from "@alea/types/candles";

export type TradeDecisionCandleState = {
  readonly asset: Asset;
  readonly period: TradeDecisionPeriod;
  readonly periodMs: number;
  /** Closed Pyth bars, ascending by openTimeMs. Canonical timeline. */
  bars: FilterBar[];
  /** Closed Coinbase bars, ascending by openTimeMs. Aligned to Pyth
   *  bars by openTimeMs at decision time. Missing bars (Coinbase
   *  gap) mean volume filters abstain at those timestamps. */
  coinbaseBars: FilterBar[];
  lastPredictedBoundary: number;
  lastRefreshedAtMs: number | null;
};

export type TradeDecisionCandleRefresh = {
  readonly currentOpenTimeMs: number;
  readonly fetchedBarCount: number;
  readonly closedBarCount: number;
  readonly latestPrice: LatestPythPrice | null;
  readonly priceAgeMs: number | null;
  readonly syntheticBar: FilterBar | null;
  readonly seriesForDecision: AlignedBarSeries | null;
};

export type FetchCandles = (params: {
  readonly asset: Asset;
  readonly timeframe: TradeDecisionPeriod;
  readonly start: Date;
  readonly end: Date;
}) => Promise<readonly Candle[]>;

type FetchLatestPrices = (params: {
  readonly assets: readonly Asset[];
}) => Promise<ReadonlyMap<Asset, LatestPythPrice>>;

export async function hydrateTradeDecisionCandleState({
  asset,
  period,
  limit = TRADE_DECISION_HYDRATE_BARS,
  nowMs = Date.now(),
  fetchCandles = fetchPythCandles,
  fetchCoinbaseBarsForHydrate = fetchHydrateCoinbaseCandles,
}: {
  readonly asset: Asset;
  readonly period: TradeDecisionPeriod;
  readonly limit?: number;
  readonly nowMs?: number;
  readonly fetchCandles?: FetchCandles;
  readonly fetchCoinbaseBarsForHydrate?: FetchCandles;
}): Promise<TradeDecisionCandleState> {
  const periodMs = resolutionTimeframeStepMs({ timeframe: period });
  const currentOpenTimeMs = Math.floor(nowMs / periodMs) * periodMs;
  const startMs = Math.max(0, currentOpenTimeMs - periodMs * (limit + 2));
  // Pyth is the canonical timeline + drives outcome labeling, so we
  // fail the hydration if it errors. Coinbase carries volume input
  // for the subset of filters that need it; treat its fetch as soft
  // — an empty Coinbase set just makes volume filters abstain.
  const [candles, coinbaseCandles] = await Promise.all([
    fetchCandles({
      asset,
      timeframe: period,
      start: new Date(startMs),
      end: new Date(nowMs),
    }),
    fetchCoinbaseBarsForHydrate({
      asset,
      timeframe: period,
      start: new Date(startMs),
      end: new Date(nowMs),
    }).catch(() => [] as readonly Candle[]),
  ]);
  const closedBars = candles
    .map(candleToFilterBar)
    .filter((bar) => bar.openTimeMs < currentOpenTimeMs);
  const closedCoinbaseBars = coinbaseCandles
    .map(candleToFilterBar)
    .filter((bar) => bar.openTimeMs < currentOpenTimeMs);
  return {
    asset,
    period,
    periodMs,
    bars: upsertFilterBars({ existing: [], incoming: closedBars, limit }),
    coinbaseBars: upsertFilterBars({
      existing: [],
      incoming: closedCoinbaseBars,
      limit,
    }),
    lastPredictedBoundary: 0,
    lastRefreshedAtMs: null,
  };
}

export async function refreshTradeDecisionCandleState({
  state,
  nowMs,
  limit = TRADE_DECISION_HYDRATE_BARS,
  maxPriceAgeMs = TRADE_DECISION_MAX_PRICE_AGE_MS,
  fetchCandles = fetchDecisionPythCandles,
  fetchCoinbaseBarsForRefresh = fetchDecisionCoinbaseCandles,
  fetchLatestPrices = fetchLatestPythPrices,
}: {
  readonly state: TradeDecisionCandleState;
  readonly nowMs: number;
  readonly limit?: number;
  readonly maxPriceAgeMs?: number;
  readonly fetchCandles?: FetchCandles;
  readonly fetchCoinbaseBarsForRefresh?: FetchCandles;
  readonly fetchLatestPrices?: FetchLatestPrices;
}): Promise<TradeDecisionCandleRefresh> {
  const currentOpenTimeMs = Math.floor(nowMs / state.periodMs) * state.periodMs;
  const fetchStartMs = getRefreshFetchStartMs({
    state,
    currentOpenTimeMs,
    limit,
  });
  // Fetch Pyth (canonical timeline + active bar synthesis) and
  // Coinbase (volume input for volume-source filters) concurrently.
  // Coinbase fetch failure is soft — volume filters abstain on this
  // decision moment if the bundle can't be assembled.
  const [candles, coinbaseCandles] = await Promise.all([
    fetchCandles({
      asset: state.asset,
      timeframe: state.period,
      start: new Date(fetchStartMs),
      end: new Date(nowMs),
    }),
    fetchCoinbaseBarsForRefresh({
      asset: state.asset,
      timeframe: state.period,
      start: new Date(fetchStartMs),
      end: new Date(nowMs),
    }).catch(() => [] as readonly Candle[]),
  ]);
  const fetchedBars = candles.map(candleToFilterBar);
  const closedBars = fetchedBars.filter(
    (bar) => bar.openTimeMs < currentOpenTimeMs,
  );
  const fetchedCoinbaseBars = coinbaseCandles.map(candleToFilterBar);
  const closedCoinbaseBars = fetchedCoinbaseBars.filter(
    (bar) => bar.openTimeMs < currentOpenTimeMs,
  );
  state.bars = upsertFilterBars({
    existing: state.bars,
    incoming: closedBars,
    limit,
  });
  state.coinbaseBars = upsertFilterBars({
    existing: state.coinbaseBars,
    incoming: closedCoinbaseBars,
    limit,
  });
  state.lastRefreshedAtMs = nowMs;

  const latestPrices = await fetchLatestPrices({ assets: [state.asset] });
  const latestPrice = latestPrices.get(state.asset) ?? null;
  if (latestPrice === null) {
    return {
      currentOpenTimeMs,
      fetchedBarCount: fetchedBars.length,
      closedBarCount: closedBars.length,
      latestPrice,
      priceAgeMs: null,
      syntheticBar: null,
      seriesForDecision: null,
    };
  }

  const priceAgeMs = Math.max(0, nowMs - latestPrice.publishTimeMs);
  if (priceAgeMs > maxPriceAgeMs) {
    return {
      currentOpenTimeMs,
      fetchedBarCount: fetchedBars.length,
      closedBarCount: closedBars.length,
      latestPrice,
      priceAgeMs,
      syntheticBar: null,
      seriesForDecision: null,
    };
  }

  const partialBar =
    fetchedBars.find((bar) => bar.openTimeMs === currentOpenTimeMs) ?? null;
  const syntheticBar = synthesizeActiveBar({
    currentOpenTimeMs,
    partialBar,
    priorClose: state.bars.at(-1)?.close ?? null,
    price: latestPrice.price,
  });
  if (syntheticBar === null) {
    return {
      currentOpenTimeMs,
      fetchedBarCount: fetchedBars.length,
      closedBarCount: closedBars.length,
      latestPrice,
      priceAgeMs,
      syntheticBar: null,
      seriesForDecision: null,
    };
  }
  // Coinbase active bar: take the partial bar Coinbase returned for
  // the open period (the Advanced Trade API serves partial 5m/15m
  // bars). If absent, the active slot is null and volume filters
  // abstain for this boundary.
  const coinbasePartial =
    fetchedCoinbaseBars.find((bar) => bar.openTimeMs === currentOpenTimeMs) ??
    null;
  const pythSeries = [...state.bars, syntheticBar];
  const coinbaseSeries = [
    ...state.coinbaseBars,
    ...(coinbasePartial === null ? [] : [coinbasePartial]),
  ];
  const seriesForDecision = alignBarSeries({
    pyth: pythSeries,
    coinbase: coinbaseSeries,
  });
  return {
    currentOpenTimeMs,
    fetchedBarCount: fetchedBars.length,
    closedBarCount: closedBars.length,
    latestPrice,
    priceAgeMs,
    syntheticBar,
    seriesForDecision,
  };
}

export function getRefreshFetchStartMs({
  state,
  currentOpenTimeMs,
  limit,
}: {
  readonly state: TradeDecisionCandleState;
  readonly currentOpenTimeMs: number;
  readonly limit: number;
}): number {
  const fullHydrationStartMs =
    currentOpenTimeMs - state.periodMs * (limit + 2);
  if (state.bars.length < limit) {
    return Math.max(0, fullHydrationStartMs);
  }

  const latestKnownOpenTimeMs = state.bars.at(-1)?.openTimeMs ?? null;
  const recentStartMs =
    currentOpenTimeMs -
    state.periodMs * TRADE_DECISION_REFRESH_LOOKBACK_BARS;
  if (latestKnownOpenTimeMs === null) {
    return Math.max(0, fullHydrationStartMs);
  }
  return Math.max(0, Math.min(latestKnownOpenTimeMs, recentStartMs));
}

export function upsertFilterBars({
  existing,
  incoming,
  limit,
}: {
  readonly existing: readonly FilterBar[];
  readonly incoming: readonly FilterBar[];
  readonly limit: number;
}): FilterBar[] {
  const byOpen = new Map<number, FilterBar>();
  for (const bar of existing) {
    byOpen.set(bar.openTimeMs, bar);
  }
  for (const bar of incoming) {
    byOpen.set(bar.openTimeMs, bar);
  }
  return [...byOpen.values()]
    .sort((a, b) => a.openTimeMs - b.openTimeMs)
    .slice(-limit);
}

function candleToFilterBar(candle: Candle): FilterBar {
  return {
    openTimeMs: candle.timestamp.getTime(),
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
  };
}

async function fetchDecisionPythCandles(
  params: Parameters<typeof fetchPythCandles>[0],
): Promise<readonly Candle[]> {
  return fetchPythCandles({
    ...params,
    requestTimeoutMs: TRADE_DECISION_CANDLE_FETCH_TIMEOUT_MS,
    maxRateLimitRetries: 0,
  });
}

async function fetchDecisionCoinbaseCandles(params: {
  readonly asset: Asset;
  readonly timeframe: TradeDecisionPeriod;
  readonly start: Date;
  readonly end: Date;
}): Promise<readonly Candle[]> {
  return fetchCoinbaseCandles(params);
}

async function fetchHydrateCoinbaseCandles(params: {
  readonly asset: Asset;
  readonly timeframe: TradeDecisionPeriod;
  readonly start: Date;
  readonly end: Date;
}): Promise<readonly Candle[]> {
  return fetchCoinbaseCandles(params);
}

function synthesizeActiveBar({
  currentOpenTimeMs,
  partialBar,
  priorClose,
  price,
}: {
  readonly currentOpenTimeMs: number;
  readonly partialBar: FilterBar | null;
  readonly priorClose: number | null;
  readonly price: number;
}): FilterBar | null {
  if (partialBar !== null) {
    return {
      openTimeMs: currentOpenTimeMs,
      open: partialBar.open,
      high: Math.max(partialBar.high, price),
      low: Math.min(partialBar.low, price),
      close: price,
      volume: partialBar.volume,
    };
  }
  if (priorClose === null) {
    return null;
  }
  return {
    openTimeMs: currentOpenTimeMs,
    open: priorClose,
    high: Math.max(priorClose, price),
    low: Math.min(priorClose, price),
    close: price,
    volume: 0,
  };
}
