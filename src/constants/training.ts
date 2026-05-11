/**
 * Minimum absolute open-to-close move, in percent, required before a
 * Pyth candle becomes a training outcome. Example: 0.01 means
 * 0.01%, not 0.01 as a fraction.
 */
export const TRAINING_OUTCOME_MIN_ABS_MOVE_PCT = 0.01;

/**
 * Persisted on derived backtest rows so old labels are not reused after
 * changing the training outcome rule. Bump the version if the logic
 * changes without changing the numeric threshold.
 */
export const TRAINING_OUTCOME_PROFILE_ID = `pyth-open-close-min-abs-move-pct-v1:${TRAINING_OUTCOME_MIN_ABS_MOVE_PCT}`;
