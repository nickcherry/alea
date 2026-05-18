import type { FilterEvaluation } from "@alea/lib/filters/types";
import type { MarketBar } from "@alea/lib/marketSeries/types";

export type CompressionBreakoutBaseConfig = {
  readonly tightWindow: number;
  readonly baselineWindow: number;
  readonly maxTightRatio: number;
  readonly minBodyPct: number;
  readonly minCloseLocation: number;
  readonly maxSignalAgeBars: number;
};

export type CompressionBreakoutTrigger = {
  readonly direction: "up" | "down";
  readonly confirmedIndex: number;
  readonly compressionHigh: number;
  readonly compressionLow: number;
  readonly tightRangeAvg: number;
  readonly baselineRangeAvg: number;
  readonly closeLocation: number;
  readonly bodyPct: number;
};

export type CompressionBreakoutMatch =
  | {
      readonly matched: true;
      readonly bars: readonly MarketBar[];
      readonly lastIndex: number;
      readonly trigger: CompressionBreakoutTrigger;
      readonly barsAgo: number;
      readonly evaluation: FilterEvaluation;
    }
  | {
      readonly matched: false;
      readonly evaluation: FilterEvaluation;
    };

export function findRecentCompressionBreakout({
  bars,
  config,
}: {
  readonly bars: readonly MarketBar[];
  readonly config: CompressionBreakoutBaseConfig;
}): CompressionBreakoutMatch {
  validateCompressionBreakoutBaseConfig(config);
  const lastIndex = bars.length - 1;
  const firstEligibleIndex = config.baselineWindow + config.tightWindow;
  if (lastIndex < firstEligibleIndex) {
    return {
      matched: false,
      evaluation: {
        decision: "neutral",
        reason: "not enough bars for compression breakout",
      },
    };
  }
  const earliest = Math.max(
    firstEligibleIndex,
    lastIndex - config.maxSignalAgeBars,
  );
  for (let i = lastIndex; i >= earliest; i -= 1) {
    const trigger = detectCompressionBreakoutAt({ bars, index: i, config });
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
            ? `compression breakout long confirmed ${barsAgo} bar(s) ago`
            : `compression breakout short confirmed ${barsAgo} bar(s) ago`,
        metadata: {
          confirmedIndex: trigger.confirmedIndex,
          confirmedOpenTimeMs: bars[trigger.confirmedIndex]?.openTimeMs,
          compressionHigh: trigger.compressionHigh,
          compressionLow: trigger.compressionLow,
          tightRangeAvg: trigger.tightRangeAvg,
          baselineRangeAvg: trigger.baselineRangeAvg,
          closeLocation: trigger.closeLocation,
          bodyPct: trigger.bodyPct,
          barsAgo,
        },
      },
    };
  }
  return {
    matched: false,
    evaluation: {
      decision: "neutral",
      reason: "no compression breakout trigger inside recency window",
    },
  };
}

export function detectCompressionBreakoutAt({
  bars,
  index,
  config,
}: {
  readonly bars: readonly MarketBar[];
  readonly index: number;
  readonly config: CompressionBreakoutBaseConfig;
}): CompressionBreakoutTrigger | undefined {
  const bar = bars[index];
  if (bar === undefined) {
    return undefined;
  }
  if (index < config.baselineWindow + config.tightWindow) {
    return undefined;
  }
  const range = bar.high - bar.low;
  if (range <= 0) {
    return undefined;
  }
  const bodyPct = Math.abs(bar.close - bar.open) / range;
  if (bodyPct < config.minBodyPct) {
    return undefined;
  }
  const closeLocation = (bar.close - bar.low) / range;

  let tightSum = 0;
  let compressionHigh = Number.NEGATIVE_INFINITY;
  let compressionLow = Number.POSITIVE_INFINITY;
  for (let j = index - config.tightWindow; j < index; j += 1) {
    const prev = bars[j];
    if (prev === undefined) {
      return undefined;
    }
    tightSum += prev.high - prev.low;
    if (prev.high > compressionHigh) {
      compressionHigh = prev.high;
    }
    if (prev.low < compressionLow) {
      compressionLow = prev.low;
    }
  }
  let baselineSum = 0;
  const baselineStart = index - config.tightWindow - config.baselineWindow;
  for (let j = baselineStart; j < index - config.tightWindow; j += 1) {
    const prev = bars[j];
    if (prev === undefined) {
      return undefined;
    }
    baselineSum += prev.high - prev.low;
  }
  if (baselineSum <= 0) {
    return undefined;
  }
  const tightRangeAvg = tightSum / config.tightWindow;
  const baselineRangeAvg = baselineSum / config.baselineWindow;
  if (tightRangeAvg / baselineRangeAvg > config.maxTightRatio) {
    return undefined;
  }

  if (bar.close > compressionHigh && closeLocation >= config.minCloseLocation) {
    return {
      direction: "up",
      confirmedIndex: index,
      compressionHigh,
      compressionLow,
      tightRangeAvg,
      baselineRangeAvg,
      closeLocation,
      bodyPct,
    };
  }
  if (
    bar.close < compressionLow &&
    closeLocation <= 1 - config.minCloseLocation
  ) {
    return {
      direction: "down",
      confirmedIndex: index,
      compressionHigh,
      compressionLow,
      tightRangeAvg,
      baselineRangeAvg,
      closeLocation,
      bodyPct,
    };
  }
  return undefined;
}

function validateCompressionBreakoutBaseConfig(
  config: CompressionBreakoutBaseConfig,
): void {
  if (!Number.isInteger(config.tightWindow) || config.tightWindow < 3) {
    throw new Error("tightWindow must be an integer >= 3");
  }
  if (
    !Number.isInteger(config.baselineWindow) ||
    config.baselineWindow < config.tightWindow + 1
  ) {
    throw new Error("baselineWindow must be an integer > tightWindow");
  }
  if (
    !Number.isFinite(config.maxTightRatio) ||
    config.maxTightRatio <= 0 ||
    config.maxTightRatio >= 1
  ) {
    throw new Error("maxTightRatio must be a number in (0, 1)");
  }
  if (
    !Number.isFinite(config.minBodyPct) ||
    config.minBodyPct <= 0 ||
    config.minBodyPct >= 1
  ) {
    throw new Error("minBodyPct must be a number in (0, 1)");
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
