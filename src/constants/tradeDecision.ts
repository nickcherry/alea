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
 * How long before the target candle *opens* the loop snapshots the live price
 * and evaluates filters. The target candle is the *next* (not-yet-open)
 * Polymarket market window. For 1h with a 35-min lead, that means evaluating
 * at HH:25 of the current hour for the HH+1:00 – HH+2:00 target market.
 *
 * The decision must fire before the target opens so the maker order is in the
 * book while the market is still around 50c. Once the candle is in progress,
 * winning-side bids stop filling at 50c.
 *
 * See doc/DECISION_TIMING.md for the full timing semantics.
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

/**
 * Returns the open timestamp of the *target* candle — the next 1h candle
 * that has not yet started. At now=HH:20 the target is HH+1:00. At
 * now=HH:00 exactly (or any tick boundary), the target is the next tick
 * (HH+1:00), since the candle whose open == now has just started and is
 * therefore no longer predictable from "before it opens" timing.
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
 * Returns the clock time at which the decision must fire for the given
 * target candle: `target.open - leadTime`. For 1h with 35-min lead and
 * target.open = HH+1:00, fire time = HH:25.
 *
 * Do not flip the sign back to `targetTsMs + periodMs - leadTime` — that
 * semantic would put the decision *inside* the target candle, which lets
 * filters peek at partial data of the candle they are predicting and
 * invalidates every backtest number. See doc/DECISION_TIMING.md.
 */
export function tradeDecisionFireTimeMs({
  period,
  targetTsMs,
}: {
  readonly period: TradeDecisionPeriod;
  readonly targetTsMs: number;
}): number {
  void period;
  return targetTsMs - tradeDecisionLeadTimeMs({ period });
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
