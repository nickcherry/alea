import { TRAINING_OUTCOME_MIN_ABS_MOVE_PCT } from "@alea/constants/training";

export type TrainingOutcomeDirection = "up" | "down";

export function resolveTrainingOutcomeDirection({
  open,
  close,
  minAbsMovePct = TRAINING_OUTCOME_MIN_ABS_MOVE_PCT,
}: {
  readonly open: number;
  readonly close: number;
  readonly minAbsMovePct?: number;
}): TrainingOutcomeDirection | null {
  if (!Number.isFinite(open) || open <= 0) {
    throw new Error(`training outcome needs a positive finite open, got ${open}`);
  }
  if (!Number.isFinite(close)) {
    throw new Error(`training outcome needs a finite close, got ${close}`);
  }
  if (!Number.isFinite(minAbsMovePct) || minAbsMovePct < 0) {
    throw new Error(
      `training outcome threshold must be non-negative, got ${minAbsMovePct}`,
    );
  }

  const movePct = ((close - open) / open) * 100;
  if (movePct > minAbsMovePct) {
    return "up";
  }
  if (movePct < -minAbsMovePct) {
    return "down";
  }
  return null;
}
