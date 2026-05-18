import { timeframeMs } from "@alea/lib/candles/timeframeMs";
import type { Asset } from "@alea/types/assets";

/**
 * Source-of-truth knobs for filter trade decisions. Backtest + future
 * dry-run/live trading runners all read these so they all evaluate the
 * same markets with the same timing.
 *
 * New decision model:
 * - Decision fires AT the open of the candle we'd enter (no lead time,
 *   no synthetic bar).
 * - Entry price = target candle's open.
 * - Outcome window = the next N candles, starting with the entry candle.
 * - Win = price reaches +/- `TRADE_TAKE_PROFIT_PCT` from entry within
 *   those N candles (high for longs, low for shorts).
 */

export const TRADE_DECISION_SUPPORTED_PERIODS = ["1h"] as const;

export type TradeDecisionPeriod =
  (typeof TRADE_DECISION_SUPPORTED_PERIODS)[number];

export type TradeDecisionMarket = {
  readonly asset: Asset;
  readonly period: TradeDecisionPeriod;
};

/**
 * Assets currently eligible for backtest/trading. Keep this narrower
 * than the repo-wide asset whitelist when an asset should remain
 * available for candles but not for filter evaluation.
 */
export const TRADE_DECISION_TRADABLE_ASSETS = [
  "btc",
  "eth",
  "sol",
  "xrp",
  "doge",
] as const satisfies readonly Asset[];

/**
 * Default backtest/trade market set. The operational default trades
 * every currently enabled asset on 1h candles.
 */
export const TRADE_DECISION_DEFAULT_MARKETS = [
  { asset: "btc", period: "1h" },
  { asset: "eth", period: "1h" },
  { asset: "sol", period: "1h" },
  { asset: "xrp", period: "1h" },
  { asset: "doge", period: "1h" },
] as const satisfies readonly TradeDecisionMarket[];

export const TRADE_DECISION_DEFAULT_PERIODS: readonly TradeDecisionPeriod[] =
  TRADE_DECISION_SUPPORTED_PERIODS;

export const TRADE_DECISION_DEFAULT_ASSETS = TRADE_DECISION_TRADABLE_ASSETS;

/**
 * Dashboard/default display period.
 */
export const TRADE_DECISION_PRIMARY_PERIOD: TradeDecisionPeriod = "1h";

/**
 * Take-profit threshold relative to entry. A long wins if any candle
 * in the outcome window reaches `entry * (1 + TRADE_TAKE_PROFIT_PCT)`;
 * a short wins on `entry * (1 - TRADE_TAKE_PROFIT_PCT)`.
 */
export const TRADE_TAKE_PROFIT_PCT = 0.05;

/**
 * Outcome window. The number of candles (starting with the entry
 * candle itself) inside which the take-profit threshold must be touched
 * for the trade to count as a win.
 */
export const TRADE_OUTCOME_WINDOW_BARS = 5;

/**
 * How many closed bars to feed each filter at decision time. The
 * filter never sees the entry bar — its inputs end at the bar that
 * just closed before the entry candle opens.
 */
export const TRADE_DECISION_HYDRATE_BARS_BY_PERIOD: Readonly<
  Record<TradeDecisionPeriod, number>
> = {
  "1h": 288,
};

export function tradeDecisionHydrateBars({
  period,
}: {
  readonly period: TradeDecisionPeriod;
}): number {
  return TRADE_DECISION_HYDRATE_BARS_BY_PERIOD[period];
}

/**
 * Returns the open timestamp of the *target* candle — the next 1h
 * candle that has not yet opened. At now=HH:20 the target is HH+1:00.
 * At now=HH:00 exactly, the next open is HH+1:00.
 */
export function tradeDecisionTargetOpenTimeMs({
  period,
  nowMs,
}: {
  readonly period: TradeDecisionPeriod;
  readonly nowMs: number;
}): number {
  const periodMs = timeframeMs({ timeframe: period });
  return Math.floor(nowMs / periodMs) * periodMs + periodMs;
}

/**
 * Clock time at which the decision fires for the given target candle.
 * Under the current model the decision fires AT the target's open —
 * we evaluate the filter on closed bars only and enter at
 * `target.open`. No lead time.
 */
export function tradeDecisionFireTimeMs({
  period,
  targetTsMs,
}: {
  readonly period: TradeDecisionPeriod;
  readonly targetTsMs: number;
}): number {
  void period;
  return targetTsMs;
}

export function nextTradeDecisionFireTimeMs({
  period,
  nowMs,
}: {
  readonly period: TradeDecisionPeriod;
  readonly nowMs: number;
}): number {
  const periodMs = timeframeMs({ timeframe: period });
  let target = tradeDecisionTargetOpenTimeMs({ period, nowMs });
  let fireTime = tradeDecisionFireTimeMs({ period, targetTsMs: target });
  if (fireTime < nowMs) {
    target = target + periodMs;
    fireTime = tradeDecisionFireTimeMs({ period, targetTsMs: target });
  }
  return fireTime;
}

export function resolveTradeDecisionMarkets({
  markets,
  assets,
  periods,
}: {
  readonly markets?: readonly TradeDecisionMarket[];
  readonly assets?: readonly Asset[];
  readonly periods?: readonly TradeDecisionPeriod[];
}): readonly TradeDecisionMarket[] {
  if (markets !== undefined) {
    return uniqueTradeDecisionMarkets({ markets });
  }
  if (assets === undefined && periods === undefined) {
    return [...TRADE_DECISION_DEFAULT_MARKETS];
  }
  const selectedAssets =
    assets === undefined || assets.length === 0
      ? TRADE_DECISION_DEFAULT_ASSETS
      : assets;
  const selectedPeriods =
    periods === undefined || periods.length === 0
      ? TRADE_DECISION_DEFAULT_PERIODS
      : periods;
  const expanded: TradeDecisionMarket[] = [];
  for (const asset of selectedAssets) {
    for (const period of selectedPeriods) {
      expanded.push({ asset, period });
    }
  }
  return uniqueTradeDecisionMarkets({ markets: expanded });
}

export function tradeDecisionMarketPeriods({
  markets,
}: {
  readonly markets: readonly TradeDecisionMarket[];
}): readonly TradeDecisionPeriod[] {
  return [...new Set(markets.map((market) => market.period))];
}

export function tradeDecisionMarketAssets({
  markets,
}: {
  readonly markets: readonly TradeDecisionMarket[];
}): readonly Asset[] {
  return [...new Set(markets.map((market) => market.asset))];
}

export function formatTradeDecisionMarkets({
  markets,
}: {
  readonly markets: readonly TradeDecisionMarket[];
}): string {
  return markets.map((market) => `${market.period}/${market.asset}`).join(",");
}

function uniqueTradeDecisionMarkets({
  markets,
}: {
  readonly markets: readonly TradeDecisionMarket[];
}): readonly TradeDecisionMarket[] {
  const seen = new Set<string>();
  const out: TradeDecisionMarket[] = [];
  for (const market of markets) {
    const key = `${market.asset}|${market.period}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(market);
  }
  return out;
}
