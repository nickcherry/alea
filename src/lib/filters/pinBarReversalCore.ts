import type { FilterEvaluation } from "@alea/lib/filters/types";
import type { MarketBar } from "@alea/lib/marketSeries/types";

export type PinBarReversalBaseConfig = {
  readonly lookbackBars: number;
  readonly minWickPct: number;
  readonly maxBodyPct: number;
  readonly minCloseAcrossBodyPct: number;
  readonly maxSignalAgeBars: number;
};

export type PinBarReversalTrigger = {
  readonly direction: "up" | "down";
  readonly confirmedIndex: number;
  readonly wickPct: number;
  readonly bodyPct: number;
  readonly closeLocation: number;
  readonly extremeExtreme: number;
};

export type PinBarReversalMatch =
  | {
      readonly matched: true;
      readonly bars: readonly MarketBar[];
      readonly lastIndex: number;
      readonly trigger: PinBarReversalTrigger;
      readonly barsAgo: number;
      readonly evaluation: FilterEvaluation;
    }
  | {
      readonly matched: false;
      readonly evaluation: FilterEvaluation;
    };

export function findRecentPinBarReversal({
  bars,
  config,
}: {
  readonly bars: readonly MarketBar[];
  readonly config: PinBarReversalBaseConfig;
}): PinBarReversalMatch {
  validatePinBarReversalBaseConfig(config);
  const lastIndex = bars.length - 1;
  if (lastIndex < config.lookbackBars) {
    return {
      matched: false,
      evaluation: {
        decision: "neutral",
        reason: "not enough bars for pin bar reversal",
      },
    };
  }
  const earliest = Math.max(
    config.lookbackBars,
    lastIndex - config.maxSignalAgeBars,
  );
  for (let i = lastIndex; i >= earliest; i -= 1) {
    const trigger = detectPinBarReversalAt({ bars, index: i, config });
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
            ? `bullish pin bar at recent low confirmed ${barsAgo} bar(s) ago`
            : `bearish pin bar at recent high confirmed ${barsAgo} bar(s) ago`,
        metadata: {
          confirmedIndex: trigger.confirmedIndex,
          confirmedOpenTimeMs: bars[trigger.confirmedIndex]?.openTimeMs,
          wickPct: trigger.wickPct,
          bodyPct: trigger.bodyPct,
          closeLocation: trigger.closeLocation,
          extremeExtreme: trigger.extremeExtreme,
          barsAgo,
        },
      },
    };
  }
  return {
    matched: false,
    evaluation: {
      decision: "neutral",
      reason: "no pin bar reversal inside recency window",
    },
  };
}

export function detectPinBarReversalAt({
  bars,
  index,
  config,
}: {
  readonly bars: readonly MarketBar[];
  readonly index: number;
  readonly config: PinBarReversalBaseConfig;
}): PinBarReversalTrigger | undefined {
  const bar = bars[index];
  if (bar === undefined) {
    return undefined;
  }
  if (index < config.lookbackBars) {
    return undefined;
  }
  const range = bar.high - bar.low;
  if (range <= 0) {
    return undefined;
  }
  const bodyPct = Math.abs(bar.close - bar.open) / range;
  if (bodyPct > config.maxBodyPct) {
    return undefined;
  }
  const closeLocation = (bar.close - bar.low) / range;
  const lowerWickPct = (Math.min(bar.open, bar.close) - bar.low) / range;
  const upperWickPct = (bar.high - Math.max(bar.open, bar.close)) / range;

  let priorLow = Number.POSITIVE_INFINITY;
  let priorHigh = Number.NEGATIVE_INFINITY;
  for (let j = index - config.lookbackBars; j < index; j += 1) {
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

  if (
    bar.low <= priorLow &&
    lowerWickPct >= config.minWickPct &&
    closeLocation >= config.minCloseAcrossBodyPct
  ) {
    return {
      direction: "up",
      confirmedIndex: index,
      wickPct: lowerWickPct,
      bodyPct,
      closeLocation,
      extremeExtreme: bar.low,
    };
  }
  if (
    bar.high >= priorHigh &&
    upperWickPct >= config.minWickPct &&
    closeLocation <= 1 - config.minCloseAcrossBodyPct
  ) {
    return {
      direction: "down",
      confirmedIndex: index,
      wickPct: upperWickPct,
      bodyPct,
      closeLocation,
      extremeExtreme: bar.high,
    };
  }
  return undefined;
}

function validatePinBarReversalBaseConfig(
  config: PinBarReversalBaseConfig,
): void {
  if (!Number.isInteger(config.lookbackBars) || config.lookbackBars < 2) {
    throw new Error("lookbackBars must be an integer >= 2");
  }
  if (
    !Number.isFinite(config.minWickPct) ||
    config.minWickPct <= 0.5 ||
    config.minWickPct >= 1
  ) {
    throw new Error("minWickPct must be a number in (0.5, 1)");
  }
  if (
    !Number.isFinite(config.maxBodyPct) ||
    config.maxBodyPct <= 0 ||
    config.maxBodyPct >= 0.5
  ) {
    throw new Error("maxBodyPct must be a number in (0, 0.5)");
  }
  if (
    !Number.isFinite(config.minCloseAcrossBodyPct) ||
    config.minCloseAcrossBodyPct <= 0.5 ||
    config.minCloseAcrossBodyPct >= 1
  ) {
    throw new Error("minCloseAcrossBodyPct must be a number in (0.5, 1)");
  }
  if (
    !Number.isInteger(config.maxSignalAgeBars) ||
    config.maxSignalAgeBars < 0
  ) {
    throw new Error("maxSignalAgeBars must be a non-negative integer");
  }
}
