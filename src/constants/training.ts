import { RESEARCH_WINDOW_PROFILE_ID } from "@alea/constants/researchWindows";
import {
  TRADE_DECISION_LEAD_TIME_BY_PERIOD_MS,
  TRADE_DECISION_SUPPORTED_PERIODS,
} from "@alea/constants/tradeDecision";

/**
 * Minimum absolute open-to-close move, in percent, required before a
 * Pyth candle becomes a training outcome. Example: 0.01 means
 * 0.01%, not 0.01 as a fraction.
 */
export const TRAINING_OUTCOME_MIN_ABS_MOVE_PCT = 0.02;

/**
 * Persisted on derived training rows so old labels are not reused after
 * changing the training outcome rule. Bump the version if the logic
 * changes without changing the numeric threshold.
 */
export const TRAINING_OUTCOME_PROFILE_ID = `pyth-open-close-min-abs-move-pct-v1:${TRAINING_OUTCOME_MIN_ABS_MOVE_PCT}`;

/**
 * Identifies what information a historical filter decision is allowed to see.
 * Training, committee backtest, dry-run, and live trading all use the same
 * period-specific decision lead and synthesize the in-flight period bar from
 * 1m candles instead of seeing a fully closed pre-target period bar.
 */
export const TRAINING_INPUT_PROFILE_ID = `synthetic-1m-lead-v1:${TRADE_DECISION_SUPPORTED_PERIODS.map((period) => `${period}=${TRADE_DECISION_LEAD_TIME_BY_PERIOD_MS[period]}`).join(",")}`;

/**
 * Persisted on derived training artifacts and committee selections. It
 * combines the outcome-labeling rule, decision-input semantics, and research
 * window identity so old derived rows cannot be reused after training inputs or
 * windows move.
 */
export const TRAINING_PROFILE_ID = `${TRAINING_OUTCOME_PROFILE_ID}|input=${TRAINING_INPUT_PROFILE_ID}|${RESEARCH_WINDOW_PROFILE_ID}`;
