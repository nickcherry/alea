import {
  marketChartRecentBarsForTimeframe,
  MAX_MARKET_CHART_RECENT_BARS,
} from "@alea/constants/marketChart";
import { timeframeMs } from "@alea/lib/candles/timeframeMs";
import type { Asset } from "@alea/types/assets";

/**
 * Source-of-truth knobs for candidate-filter trade decisions. Dry-run and
 * live trading must read these same constants so both modes evaluate the same
 * markets with the same timing and candle context.
 */

export const TRADE_DECISION_DECISION_SOURCE = "candidate_filters";

/**
 * Every candle period the dry-run table is allowed to hold a decision
 * for. Matches the `dry_run_period` CHECK constraint on
 * `dry_run_decisions.period` so the dashboard period toggle and the
 * schema agree on the option set.
 */
export const TRADE_DECISION_SUPPORTED_PERIODS = ["1h"] as const;

export type TradeDecisionPeriod =
  (typeof TRADE_DECISION_SUPPORTED_PERIODS)[number];

export type TradeDecisionMarket = {
  readonly asset: Asset;
  readonly period: TradeDecisionPeriod;
};

/**
 * Assets currently eligible for dry-run/live trading. Keep this narrower than
 * the repo-wide asset whitelist when an asset should remain available for
 * candles/research but not for order-bearing trading loops.
 */
export const TRADE_DECISION_TRADABLE_ASSETS = [
  "btc",
  "eth",
  "sol",
  "xrp",
  "doge",
] as const satisfies readonly Asset[];

/**
 * Exact no-flag dry-run/live market set. The operational default trades every
 * currently enabled trading asset on Polymarket's 1h crypto markets.
 */
export const TRADE_DECISION_DEFAULT_MARKETS = [
  { asset: "btc", period: "1h" },
  { asset: "eth", period: "1h" },
  { asset: "sol", period: "1h" },
  { asset: "xrp", period: "1h" },
  { asset: "doge", period: "1h" },
] as const satisfies readonly TradeDecisionMarket[];

/**
 * Default assets/periods used when an operator provides only one axis,
 * e.g. `--periods 1h` or `--assets eth`. With no override at all, use
 * `TRADE_DECISION_DEFAULT_MARKETS` exactly.
 */
export const TRADE_DECISION_DEFAULT_PERIODS: readonly TradeDecisionPeriod[] =
  TRADE_DECISION_SUPPORTED_PERIODS;

export const TRADE_DECISION_DEFAULT_ASSETS = TRADE_DECISION_TRADABLE_ASSETS;

/**
 * Dashboard/default display period. The runner itself uses
 * `TRADE_DECISION_DEFAULT_MARKETS`.
 */
export const TRADE_DECISION_PRIMARY_PERIOD: TradeDecisionPeriod = "1h";

/**
 * How long before the target candle closes the loop snapshots the live price
 * and evaluates filters. The target candle is the currently open Polymarket
 * market window; for 1h that means evaluating at HH:25 for the HH:00-HH:59
 * market.
 */
export const TRADE_DECISION_LEAD_TIME_BY_PERIOD_MS: Readonly<
  Record<TradeDecisionPeriod, number>
> = {
  "1h": 35 * 60 * 1000,
};

export function tradeDecisionLeadTimeMs({
  period,
}: {
  readonly period: TradeDecisionPeriod;
}): number {
  return TRADE_DECISION_LEAD_TIME_BY_PERIOD_MS[period];
}

export function tradeDecisionTargetOpenTimeMs({
  period,
  nowMs,
}: {
  readonly period: TradeDecisionPeriod;
  readonly nowMs: number;
}): number {
  const periodMs = timeframeMs({ timeframe: period });
  return Math.floor(nowMs / periodMs) * periodMs;
}

export function tradeDecisionFireTimeMs({
  period,
  targetTsMs,
}: {
  readonly period: TradeDecisionPeriod;
  readonly targetTsMs: number;
}): number {
  const periodMs = timeframeMs({ timeframe: period });
  return targetTsMs + periodMs - tradeDecisionLeadTimeMs({ period });
}

export function nextTradeDecisionFireTimeMs({
  period,
  nowMs,
}: {
  readonly period: TradeDecisionPeriod;
  readonly nowMs: number;
}): number {
  const periodMs = timeframeMs({ timeframe: period });
  const currentTargetTsMs = tradeDecisionTargetOpenTimeMs({ period, nowMs });
  const currentFireTimeMs = tradeDecisionFireTimeMs({
    period,
    targetTsMs: currentTargetTsMs,
  });
  if (nowMs < currentFireTimeMs) {
    return currentFireTimeMs;
  }
  return tradeDecisionFireTimeMs({
    period,
    targetTsMs: currentTargetTsMs + periodMs,
  });
}

/**
 * Maximum closed bars hydrated at startup. Period-specific callers should use
 * `tradeDecisionHydrateBars`; this fallback keeps tests/helper defaults large
 * enough for the longest trading chart window.
 */
export const TRADE_DECISION_HYDRATE_BARS = MAX_MARKET_CHART_RECENT_BARS;

export function tradeDecisionHydrateBars({
  period,
}: {
  readonly period: TradeDecisionPeriod;
}): number {
  return marketChartRecentBarsForTimeframe({ timeframe: period });
}

/**
 * Once startup hydration has populated the in-memory bar window, decision-time
 * refreshes only need the recent tail plus any missed bars. Keeping this small
 * reduces Pyth timeout risk in the decision path.
 */
export const TRADE_DECISION_REFRESH_LOOKBACK_BARS = 8;

/**
 * Maximum tolerated age for the one-shot Pyth price used to synthesize
 * the active candle at decision time. Pyth publishes frequently; older
 * snapshots usually mean Hermes or our network path is stale enough to
 * skip the decision instead of trading on stale state.
 */
export const TRADE_DECISION_MAX_PRICE_AGE_MS = 15 * 1000;

/**
 * Decision-time candle refresh must fail fast: waiting through the
 * normal sync/backfill retry policy would miss the market boundary.
 */
export const TRADE_DECISION_CANDLE_FETCH_TIMEOUT_MS = 4 * 1000;

/**
 * End-to-end watchdog for a single live filter decision. This must be long
 * enough for candle refresh and filter evaluation, but short enough that one
 * stuck asset cannot block every later market boundary.
 */
export const TRADE_DECISION_MAX_DECISION_DURATION_MS = 15 * 1000;

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
