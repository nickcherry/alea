const millisecondsPerDay = 86_400_000;

/**
 * Training starts at the earliest matching candle available in the DB.
 * This is intentionally a policy instead of a fixed timestamp because
 * local/bootstrap data may expand backward over time.
 */
export const TRAINING_WINDOW_START_POLICY =
  "earliest_available_candle" as const;

/**
 * Q1 2026 close, represented as a half-open upper bound. Training
 * queries should read candles whose timestamp is `< 2026-04-01T00:00:00Z`.
 */
export const TRAINING_WINDOW_END_EXCLUSIVE_MS = Date.UTC(2026, 3, 1);
export const TRAINING_WINDOW_END_INCLUSIVE_MS =
  TRAINING_WINDOW_END_EXCLUSIVE_MS - 1;

/**
 * Committee backtests use the holdout period immediately after training.
 * The dynamic end is "through yesterday" in UTC, so the exclusive bound is
 * the start of the current UTC day.
 */
export const BACKTEST_WINDOW_START_MS = TRAINING_WINDOW_END_EXCLUSIVE_MS;
export const BACKTEST_WINDOW_END_POLICY = "yesterday_utc" as const;

export const RESEARCH_WINDOW_PROFILE_ID =
  "train-earliest-through-2026-q1__backtest-2026-q2-through-yesterday-v1";

export type ResearchWindow = {
  readonly startMs: number | null;
  readonly endExclusiveMs: number;
};

export type ResolvedResearchWindows = {
  readonly training: ResearchWindow & {
    readonly startPolicy: typeof TRAINING_WINDOW_START_POLICY;
  };
  readonly backtest: Omit<ResearchWindow, "startMs"> & {
    readonly startMs: number;
    readonly endPolicy: typeof BACKTEST_WINDOW_END_POLICY;
  };
};

export function resolveBacktestWindowEndExclusiveMs({
  nowMs = Date.now(),
}: {
  readonly nowMs?: number;
} = {}): number {
  const now = new Date(nowMs);
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

export function resolveResearchWindows({
  trainingStartMs = null,
  nowMs = Date.now(),
}: {
  readonly trainingStartMs?: number | null;
  readonly nowMs?: number;
} = {}): ResolvedResearchWindows {
  const backtestEndExclusiveMs = resolveBacktestWindowEndExclusiveMs({ nowMs });
  if (backtestEndExclusiveMs <= BACKTEST_WINDOW_START_MS) {
    throw new Error(
      `backtest window ends before it starts: endExclusive=${new Date(
        backtestEndExclusiveMs,
      ).toISOString()} start=${new Date(BACKTEST_WINDOW_START_MS).toISOString()}`,
    );
  }

  return {
    training: {
      startPolicy: TRAINING_WINDOW_START_POLICY,
      startMs: trainingStartMs,
      endExclusiveMs: TRAINING_WINDOW_END_EXCLUSIVE_MS,
    },
    backtest: {
      startMs: BACKTEST_WINDOW_START_MS,
      endExclusiveMs: backtestEndExclusiveMs,
      endPolicy: BACKTEST_WINDOW_END_POLICY,
    },
  };
}

export function isInsideHalfOpenWindow({
  tsMs,
  window,
}: {
  readonly tsMs: number;
  readonly window: ResearchWindow;
}): boolean {
  return (
    (window.startMs === null || tsMs >= window.startMs) &&
    tsMs < window.endExclusiveMs
  );
}

export function endInclusiveMs({
  window,
}: {
  readonly window: ResearchWindow;
}): number {
  return window.endExclusiveMs - 1;
}

export function windowDurationDays({
  window,
}: {
  readonly window: ResearchWindow;
}): number | null {
  if (window.startMs === null) {
    return null;
  }
  return (window.endExclusiveMs - window.startMs) / millisecondsPerDay;
}
