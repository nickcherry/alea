import type { FilterEvaluation } from "@alea/lib/filters/types";
import type { MarketBar } from "@alea/lib/marketSeries/types";

export type StreakReversalBaseConfig = {
  readonly streakLength: number;
  readonly minTotalReturnPct: number;
  readonly maxSignalAgeBars: number;
};

export type StreakReversalTrigger = {
  readonly direction: "up" | "down";
  readonly confirmedIndex: number;
  readonly streakReturnPct: number;
  readonly streakStartIndex: number;
};

export type StreakReversalMatch =
  | {
      readonly matched: true;
      readonly bars: readonly MarketBar[];
      readonly lastIndex: number;
      readonly trigger: StreakReversalTrigger;
      readonly barsAgo: number;
      readonly evaluation: FilterEvaluation;
    }
  | {
      readonly matched: false;
      readonly evaluation: FilterEvaluation;
    };

export function findRecentStreakReversal({
  bars,
  config,
}: {
  readonly bars: readonly MarketBar[];
  readonly config: StreakReversalBaseConfig;
}): StreakReversalMatch {
  validateStreakReversalBaseConfig(config);
  const lastIndex = bars.length - 1;
  if (lastIndex < config.streakLength) {
    return {
      matched: false,
      evaluation: {
        decision: "neutral",
        reason: "not enough bars for streak reversal",
      },
    };
  }
  const earliest = Math.max(
    config.streakLength,
    lastIndex - config.maxSignalAgeBars,
  );
  for (let i = lastIndex; i >= earliest; i -= 1) {
    const trigger = detectStreakReversalAt({ bars, index: i, config });
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
            ? `${config.streakLength}-bar down streak — bet up (mean reversion) ${barsAgo} bar(s) ago`
            : `${config.streakLength}-bar up streak — bet down (mean reversion) ${barsAgo} bar(s) ago`,
        metadata: {
          confirmedIndex: trigger.confirmedIndex,
          confirmedOpenTimeMs: bars[trigger.confirmedIndex]?.openTimeMs,
          streakReturnPct: trigger.streakReturnPct,
          streakStartIndex: trigger.streakStartIndex,
          barsAgo,
        },
      },
    };
  }
  return {
    matched: false,
    evaluation: {
      decision: "neutral",
      reason: "no streak reversal trigger inside recency window",
    },
  };
}

export function detectStreakReversalAt({
  bars,
  index,
  config,
}: {
  readonly bars: readonly MarketBar[];
  readonly index: number;
  readonly config: StreakReversalBaseConfig;
}): StreakReversalTrigger | undefined {
  if (index < config.streakLength) {
    return undefined;
  }
  const streakStartIndex = index - config.streakLength;
  let allGreen = true;
  let allRed = true;
  for (let j = streakStartIndex; j < index; j += 1) {
    const bar = bars[j];
    if (bar === undefined) {
      return undefined;
    }
    if (bar.close <= bar.open) {
      allGreen = false;
    }
    if (bar.close >= bar.open) {
      allRed = false;
    }
    if (!allGreen && !allRed) {
      return undefined;
    }
  }
  const streakStartBar = bars[streakStartIndex];
  const streakEndBar = bars[index - 1];
  if (streakStartBar === undefined || streakEndBar === undefined) {
    return undefined;
  }
  if (streakStartBar.open <= 0) {
    return undefined;
  }
  const streakReturnPct =
    (streakEndBar.close - streakStartBar.open) / streakStartBar.open;
  if (Math.abs(streakReturnPct) < config.minTotalReturnPct) {
    return undefined;
  }
  if (allGreen) {
    return {
      direction: "down",
      confirmedIndex: index,
      streakReturnPct,
      streakStartIndex,
    };
  }
  if (allRed) {
    return {
      direction: "up",
      confirmedIndex: index,
      streakReturnPct,
      streakStartIndex,
    };
  }
  return undefined;
}

function validateStreakReversalBaseConfig(
  config: StreakReversalBaseConfig,
): void {
  if (!Number.isInteger(config.streakLength) || config.streakLength < 2) {
    throw new Error("streakLength must be an integer >= 2");
  }
  if (
    !Number.isFinite(config.minTotalReturnPct) ||
    config.minTotalReturnPct < 0
  ) {
    throw new Error("minTotalReturnPct must be a non-negative number");
  }
  if (
    !Number.isInteger(config.maxSignalAgeBars) ||
    config.maxSignalAgeBars < 0
  ) {
    throw new Error("maxSignalAgeBars must be a non-negative integer");
  }
}
