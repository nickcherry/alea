import { RESEARCH_WINDOW_PROFILE_ID } from "@alea/constants/researchWindows";
import { TRADE_DECISION_TIMING_PROFILE_ID } from "@alea/constants/tradeDecision";

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
 * Persisted on derived training artifacts and committee selections. It
 * combines the outcome-labeling rule, decision-timing contract, and
 * research window identity so old derived rows cannot be reused after
 * training, live timing, or holdout windows move.
 */
export const TRAINING_PROFILE_ID = `${TRAINING_OUTCOME_PROFILE_ID}|${TRADE_DECISION_TIMING_PROFILE_ID}|${RESEARCH_WINDOW_PROFILE_ID}`;
