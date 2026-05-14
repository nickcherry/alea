import type { MarketRegime } from "@alea/lib/regime/types";

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
 * Candle periods the dry-run trader predicts when the CLI does not
 * provide an override.
 */
export const TRADE_DECISION_DEFAULT_PERIODS: readonly TradeDecisionPeriod[] =
  TRADE_DECISION_SUPPORTED_PERIODS;

/**
 * Dashboard/default display period. The runner itself uses
 * `TRADE_DECISION_DEFAULT_PERIODS`.
 */
export const TRADE_DECISION_PRIMARY_PERIOD: TradeDecisionPeriod = "5m";

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
export const MIN_COMMITTEE_VOTES_TO_TRADE = 3;

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
