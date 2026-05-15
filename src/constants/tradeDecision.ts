import type { MarketRegime } from "@alea/lib/regime/types";
import type { Asset } from "@alea/types/assets";

/**
 * Source-of-truth knobs for turning committee votes into an
 * actionable trade decision. Dry-run and live trading must read
 * these same constants so both modes accept or reject trades by the
 * same policy.
 */

/**
 * Every candle period the dry-run table is allowed to hold a decision
 * for. Matches the `dry_run_period` CHECK constraint on
 * `dry_run_decisions.period` so the dashboard period toggle and the
 * schema agree on the option set.
 */
export const TRADE_DECISION_SUPPORTED_PERIODS = ["5m", "15m"] as const;

export type TradeDecisionPeriod =
  (typeof TRADE_DECISION_SUPPORTED_PERIODS)[number];

export type TradeDecisionMarket = {
  readonly asset: Asset;
  readonly period: TradeDecisionPeriod;
};

export type CommitteeDecisionRules = {
  readonly maxVotesPerFilter: number;
  readonly minVotesToTrade: number;
  readonly minConsensusFraction: number;
};

/**
 * Market regimes allowed to produce an actionable trade. Backtest,
 * dry-run, and live trading all consult this same allow-list after
 * classifying the current bar window.
 *
 * Keep this list deliberately small. To re-enable high-vol trading,
 * add one or both high-vol regimes below and rerun `backtest:run`
 * before restarting dry-run/live processes.
 */
export const TRADE_DECISION_ALLOWED_MARKET_REGIMES = [
  "low_vol_trending",
  "low_vol_ranging",
  // "high_vol_trending",
  // "high_vol_ranging",
] as const satisfies readonly MarketRegime[];

export type TradeDecisionAllowedMarketRegime =
  (typeof TRADE_DECISION_ALLOWED_MARKET_REGIMES)[number];

export function isTradeDecisionMarketRegimeAllowed(
  marketRegime: MarketRegime | null,
): marketRegime is TradeDecisionAllowedMarketRegime {
  return (
    marketRegime !== null &&
    TRADE_DECISION_ALLOWED_MARKET_REGIMES.includes(
      marketRegime as TradeDecisionAllowedMarketRegime,
    )
  );
}

/**
 * Exact no-flag dry-run/live market set. Top-12 committee selection trims the
 * marginal low-rank voters enough to put the full BTC/ETH/SOL 5m+15m surface
 * back in the operational default.
 */
export const TRADE_DECISION_DEFAULT_MARKETS = [
  { asset: "btc", period: "5m" },
  { asset: "btc", period: "15m" },
  { asset: "eth", period: "5m" },
  { asset: "eth", period: "15m" },
  { asset: "sol", period: "5m" },
  { asset: "sol", period: "15m" },
] as const satisfies readonly TradeDecisionMarket[];

/**
 * Default assets/periods used when an operator provides only one axis,
 * e.g. `--periods 15m` or `--assets eth`. With no override at all, use
 * `TRADE_DECISION_DEFAULT_MARKETS` exactly.
 */
export const TRADE_DECISION_DEFAULT_PERIODS: readonly TradeDecisionPeriod[] =
  TRADE_DECISION_SUPPORTED_PERIODS;

export const TRADE_DECISION_DEFAULT_ASSETS = [
  "btc",
  "eth",
  "sol",
] as const satisfies readonly Asset[];

/**
 * Dashboard/default display period. The runner itself uses
 * `TRADE_DECISION_DEFAULT_MARKETS`.
 */
export const TRADE_DECISION_PRIMARY_PERIOD: TradeDecisionPeriod = "15m";

/**
 * How long before each target candle opens the loop snapshots the live price
 * and makes its decision. The order path enters immediately after an
 * actionable decision.
 */
export const TRADE_DECISION_LEAD_TIME_BY_PERIOD_MS: Readonly<
  Record<TradeDecisionPeriod, number>
> = {
  "5m": 2 * 60 * 1000,
  "15m": 3 * 60 * 1000,
};

export function tradeDecisionLeadTimeMs({
  period,
}: {
  readonly period: TradeDecisionPeriod;
}): number {
  return TRADE_DECISION_LEAD_TIME_BY_PERIOD_MS[period];
}

/**
 * Closed bars hydrated at startup. This must cover the regime
 * classifier and the deepest registered filter lookback.
 */
export const TRADE_DECISION_HYDRATE_BARS = 150;

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
 * A single filter may have multiple selected configs in a regime
 * bucket, but it can contribute only one active vote to a trade.
 */
export const MAX_COMMITTEE_VOTES_PER_FILTER = 1;

/** Minimum non-abstain, filter-collapsed votes required to trade. */
export const MIN_COMMITTEE_VOTES_TO_TRADE = 2;

/**
 * Minimum share of non-abstain votes that the winning side must
 * hold. Ties still abstain separately, so 0.5 is simple majority.
 */
export const MIN_COMMITTEE_CONSENSUS_FRACTION = 0.5;

export const DEFAULT_COMMITTEE_DECISION_RULES: CommitteeDecisionRules = {
  maxVotesPerFilter: MAX_COMMITTEE_VOTES_PER_FILTER,
  minVotesToTrade: MIN_COMMITTEE_VOTES_TO_TRADE,
  minConsensusFraction: MIN_COMMITTEE_CONSENSUS_FRACTION,
};

export const TRADE_DECISION_FILTER_TIE_BREAK =
  "highest_win_rate_then_engagements_then_rank";

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
