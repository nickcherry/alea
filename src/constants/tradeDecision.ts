/**
 * Source-of-truth knobs for turning committee votes into an
 * actionable trade decision. Dry-run and live trading must read
 * these same constants so both modes accept or reject trades by the
 * same policy.
 */

/** Candle period the current trade-decision loop predicts. */
export const TRADE_DECISION_PERIOD = "5m";

/**
 * How long before the target candle opens the loop snapshots the
 * live price and makes its decision.
 */
export const TRADE_DECISION_LEAD_TIME_MS = 5 * 1000;

/**
 * Closed bars hydrated at startup. This must cover the regime
 * classifier and the deepest registered filter lookback.
 */
export const TRADE_DECISION_HYDRATE_BARS = 150;

/**
 * A single filter may have multiple selected configs in a regime
 * bucket, but it can contribute only one active vote to a trade.
 */
export const MAX_COMMITTEE_VOTES_PER_FILTER = 1;

/** Minimum non-abstain, filter-collapsed votes required to trade. */
export const MIN_COMMITTEE_VOTES_TO_TRADE = 1;

/**
 * Minimum share of non-abstain votes that the winning side must
 * hold. Ties still abstain separately, so 0.5 is simple majority.
 */
export const MIN_COMMITTEE_CONSENSUS_FRACTION = 0.5;

export const TRADE_DECISION_FILTER_TIE_BREAK =
  "highest_win_rate_then_engagements_then_rank";
