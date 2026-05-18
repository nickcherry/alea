import type { FilterEvaluation } from "@alea/lib/filters/types";
import type { MarketBar } from "@alea/lib/marketSeries/types";

export type FailedBreakoutReversalBaseConfig = {
  readonly lookbackBars: number;
  readonly minCloseLocation: number;
  readonly maxSignalAgeBars: number;
};

export type FailedBreakoutReversalTrigger = {
  readonly direction: "up" | "down";
  readonly confirmedIndex: number;
  readonly priorBoundary: number;
  readonly sweepExtreme: number;
  readonly closeLocation: number;
};

export type FailedBreakoutReversalMatch =
  | {
      readonly matched: true;
      readonly bars: readonly MarketBar[];
      readonly lastIndex: number;
      readonly trigger: FailedBreakoutReversalTrigger;
      readonly barsAgo: number;
      readonly evaluation: FilterEvaluation;
    }
  | {
      readonly matched: false;
      readonly evaluation: FilterEvaluation;
    };

export function findRecentFailedBreakoutReversal({
  bars,
  config,
}: {
  readonly bars: readonly MarketBar[];
  readonly config: FailedBreakoutReversalBaseConfig;
}): FailedBreakoutReversalMatch {
  validateFailedBreakoutReversalBaseConfig(config);
  const lastIndex = bars.length - 1;
  if (lastIndex < config.lookbackBars) {
    return {
      matched: false,
      evaluation: {
        decision: "neutral",
        reason: "not enough bars for failed-breakout lookback",
      },
    };
  }

  const earliestCandidateIndex = Math.max(
    config.lookbackBars,
    lastIndex - config.maxSignalAgeBars,
  );

  for (let i = lastIndex; i >= earliestCandidateIndex; i -= 1) {
    const trigger = detectTriggerAt({ bars, index: i, config });
    if (trigger === undefined) {
      continue;
    }
    const barsAgo = lastIndex - i;
    return {
      matched: true,
      bars,
      lastIndex,
      trigger,
      barsAgo,
      evaluation: {
        decision: trigger.direction,
        reason:
          trigger.direction === "up"
            ? `failed breakdown reclaimed; reversal long confirmed ${barsAgo} bar(s) ago`
            : `failed breakout rejected; reversal short confirmed ${barsAgo} bar(s) ago`,
        metadata: {
          confirmedIndex: trigger.confirmedIndex,
          confirmedOpenTimeMs: bars[trigger.confirmedIndex]?.openTimeMs,
          priorBoundary: trigger.priorBoundary,
          sweepExtreme: trigger.sweepExtreme,
          closeLocation: trigger.closeLocation,
          barsAgo,
        },
      },
    };
  }

  return {
    matched: false,
    evaluation: {
      decision: "neutral",
      reason:
        "no failed breakdown or breakout reversal trigger inside recency window",
    },
  };
}

export function detectTriggerAt({
  bars,
  index,
  config,
}: {
  readonly bars: readonly MarketBar[];
  readonly index: number;
  readonly config: FailedBreakoutReversalBaseConfig;
}): FailedBreakoutReversalTrigger | undefined {
  const geometric = detectGeometricTriggerAt({
    bars,
    index,
    lookbackBars: config.lookbackBars,
  });
  if (geometric === undefined) {
    return undefined;
  }
  if (geometric.direction === "up") {
    return geometric.closeLocation >= config.minCloseLocation
      ? geometric
      : undefined;
  }
  return geometric.closeLocation <= 1 - config.minCloseLocation
    ? geometric
    : undefined;
}

export function detectGeometricTriggerAt({
  bars,
  index,
  lookbackBars,
}: {
  readonly bars: readonly MarketBar[];
  readonly index: number;
  readonly lookbackBars: number;
}): FailedBreakoutReversalTrigger | undefined {
  const bar = bars[index];
  if (bar === undefined) {
    return undefined;
  }
  if (index < lookbackBars) {
    return undefined;
  }
  const range = bar.high - bar.low;
  if (range <= 0) {
    return undefined;
  }
  const closeLocation = (bar.close - bar.low) / range;
  const start = index - lookbackBars;
  let priorLow = Number.POSITIVE_INFINITY;
  let priorHigh = Number.NEGATIVE_INFINITY;
  for (let j = start; j < index; j += 1) {
    const prior = bars[j];
    if (prior === undefined) {
      return undefined;
    }
    if (prior.low < priorLow) {
      priorLow = prior.low;
    }
    if (prior.high > priorHigh) {
      priorHigh = prior.high;
    }
  }

  if (bar.low < priorLow && bar.close > priorLow) {
    return {
      direction: "up",
      confirmedIndex: index,
      priorBoundary: priorLow,
      sweepExtreme: bar.low,
      closeLocation,
    };
  }

  if (bar.high > priorHigh && bar.close < priorHigh) {
    return {
      direction: "down",
      confirmedIndex: index,
      priorBoundary: priorHigh,
      sweepExtreme: bar.high,
      closeLocation,
    };
  }

  return undefined;
}

function validateFailedBreakoutReversalBaseConfig(
  config: FailedBreakoutReversalBaseConfig,
): void {
  if (!Number.isInteger(config.lookbackBars) || config.lookbackBars < 2) {
    throw new Error("lookbackBars must be an integer >= 2");
  }
  if (
    !Number.isFinite(config.minCloseLocation) ||
    config.minCloseLocation <= 0.5 ||
    config.minCloseLocation >= 1
  ) {
    throw new Error("minCloseLocation must be a number in (0.5, 1)");
  }
  if (
    !Number.isInteger(config.maxSignalAgeBars) ||
    config.maxSignalAgeBars < 0
  ) {
    throw new Error("maxSignalAgeBars must be a non-negative integer");
  }
}
