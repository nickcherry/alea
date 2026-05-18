import type { MarketBar } from "@alea/lib/marketSeries/types";

export type ThesisDirection = "up" | "down";

export type ThesisLifecycleConfig = {
  readonly maxAge: number;
  readonly maxConsecutiveWrong: number;
  readonly requireWrongLessThanRight: boolean;
  readonly requireFirstTradeWin: boolean;
};

export type ThesisStructuralInvalidation =
  | {
      readonly invalidated: true;
      readonly reason: string;
      readonly metadata?: Readonly<Record<string, unknown>>;
    }
  | { readonly invalidated: false };

export type ThesisStructuralCheck = (args: {
  readonly direction: ThesisDirection;
  readonly bar: MarketBar;
  readonly barIndex: number;
  readonly age: number;
  readonly bars: readonly MarketBar[];
}) => ThesisStructuralInvalidation;

export type ThesisVerdict = "right" | "wrong" | "flat";

export type ThesisLifecycleResult = {
  readonly invalidated: boolean;
  readonly reason?: string;
  readonly metadata: Readonly<Record<string, unknown>>;
};

export function verdictForBar({
  direction,
  open,
  close,
}: {
  readonly direction: ThesisDirection;
  readonly open: number;
  readonly close: number;
}): ThesisVerdict {
  if (close === open) {
    return "flat";
  }
  if (direction === "up") {
    return close > open ? "right" : "wrong";
  }
  return close < open ? "right" : "wrong";
}

export function runThesisLifecycle({
  direction,
  confirmedIndex,
  bars,
  lastIndex,
  config,
  structuralCheck,
}: {
  readonly direction: ThesisDirection;
  readonly confirmedIndex: number;
  readonly bars: readonly MarketBar[];
  readonly lastIndex: number;
  readonly config: ThesisLifecycleConfig;
  readonly structuralCheck?: ThesisStructuralCheck;
}): ThesisLifecycleResult {
  validateThesisLifecycleConfig(config);

  let right = 0;
  let wrong = 0;
  let flat = 0;
  let consecutiveWrong = 0;
  let lastAge = 0;
  let lastBar: MarketBar | undefined;

  for (
    let barIndex = confirmedIndex + 1;
    barIndex <= lastIndex;
    barIndex += 1
  ) {
    const bar = bars[barIndex];
    if (bar === undefined) {
      continue;
    }
    const age = barIndex - confirmedIndex;
    lastAge = age;
    lastBar = bar;

    if (config.maxAge > 0 && age > config.maxAge) {
      return invalidated({
        reason: `thesis exceeded max age of ${config.maxAge} bars`,
        invalidation: "max_age",
        barIndex,
        bar,
        age,
        right,
        wrong,
        flat,
        consecutiveWrong,
        config,
      });
    }

    const verdict = verdictForBar({
      direction,
      open: bar.open,
      close: bar.close,
    });
    if (verdict === "right") {
      right += 1;
      consecutiveWrong = 0;
    } else if (verdict === "wrong") {
      wrong += 1;
      consecutiveWrong += 1;
    } else {
      flat += 1;
      consecutiveWrong = 0;
    }

    if (config.requireFirstTradeWin && age === 1 && verdict === "wrong") {
      return invalidated({
        reason: "first bar after trigger was wrong",
        invalidation: "first_trade_wrong",
        barIndex,
        bar,
        age,
        right,
        wrong,
        flat,
        consecutiveWrong,
        config,
      });
    }

    if (
      config.maxConsecutiveWrong > 0 &&
      consecutiveWrong >= config.maxConsecutiveWrong
    ) {
      return invalidated({
        reason:
          config.maxConsecutiveWrong === 1
            ? "thesis invalidated by one wrong bar"
            : `thesis invalidated by ${config.maxConsecutiveWrong} consecutive wrong bars`,
        invalidation: "consecutive_wrong",
        barIndex,
        bar,
        age,
        right,
        wrong,
        flat,
        consecutiveWrong,
        config,
      });
    }

    if (config.requireWrongLessThanRight && wrong > right) {
      return invalidated({
        reason: `wrong bars (${wrong}) exceeded right bars (${right})`,
        invalidation: "wrong_exceeds_right",
        barIndex,
        bar,
        age,
        right,
        wrong,
        flat,
        consecutiveWrong,
        config,
      });
    }

    if (structuralCheck !== undefined) {
      const structural = structuralCheck({
        direction,
        bar,
        barIndex,
        age,
        bars,
      });
      if (structural.invalidated) {
        return {
          invalidated: true,
          reason: structural.reason,
          metadata: {
            ...lifecycleMetadata({
              invalidation: "structural",
              barIndex,
              bar,
              age,
              right,
              wrong,
              flat,
              consecutiveWrong,
              config,
            }),
            ...(structural.metadata ?? {}),
          },
        };
      }
    }
  }

  return {
    invalidated: false,
    metadata: lifecycleMetadata({
      invalidation: "none",
      barIndex: lastIndex,
      bar: lastBar,
      age: lastAge,
      right,
      wrong,
      flat,
      consecutiveWrong,
      config,
    }),
  };
}

function invalidated({
  reason,
  invalidation,
  barIndex,
  bar,
  age,
  right,
  wrong,
  flat,
  consecutiveWrong,
  config,
}: {
  readonly reason: string;
  readonly invalidation: string;
  readonly barIndex: number;
  readonly bar: MarketBar | undefined;
  readonly age: number;
  readonly right: number;
  readonly wrong: number;
  readonly flat: number;
  readonly consecutiveWrong: number;
  readonly config: ThesisLifecycleConfig;
}): ThesisLifecycleResult {
  return {
    invalidated: true,
    reason,
    metadata: lifecycleMetadata({
      invalidation,
      barIndex,
      bar,
      age,
      right,
      wrong,
      flat,
      consecutiveWrong,
      config,
    }),
  };
}

function lifecycleMetadata({
  invalidation,
  barIndex,
  bar,
  age,
  right,
  wrong,
  flat,
  consecutiveWrong,
  config,
}: {
  readonly invalidation: string;
  readonly barIndex: number;
  readonly bar: MarketBar | undefined;
  readonly age: number;
  readonly right: number;
  readonly wrong: number;
  readonly flat: number;
  readonly consecutiveWrong: number;
  readonly config: ThesisLifecycleConfig;
}): Readonly<Record<string, unknown>> {
  return {
    invalidation,
    invalidationIndex: barIndex,
    invalidationOpenTimeMs: bar?.openTimeMs,
    age,
    right,
    wrong,
    flat,
    consecutiveWrong,
    maxAge: config.maxAge,
    maxConsecutiveWrong: config.maxConsecutiveWrong,
    requireWrongLessThanRight: config.requireWrongLessThanRight,
    requireFirstTradeWin: config.requireFirstTradeWin,
  };
}

function validateThesisLifecycleConfig(config: ThesisLifecycleConfig): void {
  if (!Number.isInteger(config.maxAge) || config.maxAge < 0) {
    throw new Error("maxAge must be a non-negative integer (0 = unlimited)");
  }
  if (
    !Number.isInteger(config.maxConsecutiveWrong) ||
    config.maxConsecutiveWrong < 0
  ) {
    throw new Error(
      "maxConsecutiveWrong must be a non-negative integer (0 = disabled)",
    );
  }
}
