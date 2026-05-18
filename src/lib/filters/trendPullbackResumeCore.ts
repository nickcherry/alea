import type { FilterEvaluation } from "@alea/lib/filters/types";
import { computeEmaSeries } from "@alea/lib/indicators/ema";
import type { MarketBar } from "@alea/lib/marketSeries/types";

export type TrendPullbackResumeBaseConfig = {
  readonly fastEmaLength: number;
  readonly slowEmaLength: number;
  readonly slopeLookback: number;
  readonly pullbackWindow: number;
  readonly minBodyPct: number;
  readonly minCloseLocation: number;
  readonly maxSignalAgeBars: number;
};

export type TrendPullbackResumeTrigger = {
  readonly direction: "up" | "down";
  readonly confirmedIndex: number;
  readonly fastEma: number;
  readonly slowEma: number;
  readonly closeLocation: number;
  readonly bodyPct: number;
  readonly pullbackCount: number;
};

export type TrendPullbackResumeMatch =
  | {
      readonly matched: true;
      readonly bars: readonly MarketBar[];
      readonly lastIndex: number;
      readonly trigger: TrendPullbackResumeTrigger;
      readonly fastEmaSeries: readonly (number | null)[];
      readonly slowEmaSeries: readonly (number | null)[];
      readonly barsAgo: number;
      readonly evaluation: FilterEvaluation;
    }
  | {
      readonly matched: false;
      readonly evaluation: FilterEvaluation;
    };

export function findRecentTrendPullbackResume({
  bars,
  config,
}: {
  readonly bars: readonly MarketBar[];
  readonly config: TrendPullbackResumeBaseConfig;
}): TrendPullbackResumeMatch {
  validateTrendPullbackResumeBaseConfig(config);
  const lastIndex = bars.length - 1;
  const minBars =
    config.slowEmaLength + config.pullbackWindow + config.slopeLookback + 1;
  if (lastIndex < minBars) {
    return {
      matched: false,
      evaluation: {
        decision: "neutral",
        reason: "not enough bars for trend pullback resume",
      },
    };
  }

  const closes = bars.map((bar) => bar.close);
  const fastEmaSeries = computeEmaSeries({
    closes,
    period: config.fastEmaLength,
  });
  const slowEmaSeries = computeEmaSeries({
    closes,
    period: config.slowEmaLength,
  });

  const earliestCandidateIndex = Math.max(
    minBars,
    lastIndex - config.maxSignalAgeBars,
  );

  for (let i = lastIndex; i >= earliestCandidateIndex; i -= 1) {
    const trigger = detectTrendPullbackResumeAt({
      bars,
      index: i,
      fastEmaSeries,
      slowEmaSeries,
      config,
    });
    if (trigger === undefined) {
      continue;
    }
    const barsAgo = lastIndex - i;
    return {
      matched: true,
      bars,
      lastIndex,
      trigger,
      fastEmaSeries,
      slowEmaSeries,
      barsAgo,
      evaluation: {
        decision: trigger.direction,
        reason:
          trigger.direction === "up"
            ? `trend pullback resume long confirmed ${barsAgo} bar(s) ago`
            : `trend pullback resume short confirmed ${barsAgo} bar(s) ago`,
        metadata: {
          confirmedIndex: trigger.confirmedIndex,
          confirmedOpenTimeMs: bars[trigger.confirmedIndex]?.openTimeMs,
          fastEma: trigger.fastEma,
          slowEma: trigger.slowEma,
          closeLocation: trigger.closeLocation,
          bodyPct: trigger.bodyPct,
          pullbackCount: trigger.pullbackCount,
          barsAgo,
        },
      },
    };
  }

  return {
    matched: false,
    evaluation: {
      decision: "neutral",
      reason: "no trend pullback resume trigger inside recency window",
    },
  };
}

export function detectTrendPullbackResumeAt({
  bars,
  index,
  fastEmaSeries,
  slowEmaSeries,
  config,
}: {
  readonly bars: readonly MarketBar[];
  readonly index: number;
  readonly fastEmaSeries: readonly (number | null)[];
  readonly slowEmaSeries: readonly (number | null)[];
  readonly config: TrendPullbackResumeBaseConfig;
}): TrendPullbackResumeTrigger | undefined {
  const bar = bars[index];
  if (bar === undefined) {
    return undefined;
  }
  const fastEma = fastEmaSeries[index];
  const slowEma = slowEmaSeries[index];
  const priorFastEma = fastEmaSeries[index - config.slopeLookback];
  if (fastEma == null || slowEma == null || priorFastEma == null) {
    return undefined;
  }
  const range = bar.high - bar.low;
  if (range <= 0) {
    return undefined;
  }
  const closeLocation = (bar.close - bar.low) / range;
  const bodyPct = Math.abs(bar.close - bar.open) / range;
  if (bodyPct < config.minBodyPct) {
    return undefined;
  }

  const upTrend =
    fastEma > slowEma &&
    fastEma - priorFastEma > 0 &&
    bar.close > slowEma &&
    bar.close > bar.open &&
    closeLocation >= config.minCloseLocation;
  const downTrend =
    fastEma < slowEma &&
    fastEma - priorFastEma < 0 &&
    bar.close < slowEma &&
    bar.close < bar.open &&
    closeLocation <= 1 - config.minCloseLocation;

  if (!upTrend && !downTrend) {
    return undefined;
  }

  const pullbackStart = index - config.pullbackWindow;
  if (pullbackStart < 1) {
    return undefined;
  }

  let pullbackCount = 0;
  for (let j = pullbackStart; j < index; j += 1) {
    const prior = bars[j];
    const priorSlow = slowEmaSeries[j];
    if (prior === undefined || priorSlow == null) {
      return undefined;
    }
    if (upTrend) {
      if (prior.close < priorSlow) {
        return undefined;
      }
      if (prior.close < prior.open) {
        pullbackCount += 1;
      }
    } else {
      if (prior.close > priorSlow) {
        return undefined;
      }
      if (prior.close > prior.open) {
        pullbackCount += 1;
      }
    }
  }

  if (pullbackCount === 0) {
    return undefined;
  }

  return {
    direction: upTrend ? "up" : "down",
    confirmedIndex: index,
    fastEma,
    slowEma,
    closeLocation,
    bodyPct,
    pullbackCount,
  };
}

function validateTrendPullbackResumeBaseConfig(
  config: TrendPullbackResumeBaseConfig,
): void {
  if (!Number.isInteger(config.fastEmaLength) || config.fastEmaLength < 2) {
    throw new Error("fastEmaLength must be an integer >= 2");
  }
  if (
    !Number.isInteger(config.slowEmaLength) ||
    config.slowEmaLength <= config.fastEmaLength
  ) {
    throw new Error("slowEmaLength must be an integer > fastEmaLength");
  }
  if (!Number.isInteger(config.slopeLookback) || config.slopeLookback < 1) {
    throw new Error("slopeLookback must be a positive integer");
  }
  if (!Number.isInteger(config.pullbackWindow) || config.pullbackWindow < 1) {
    throw new Error("pullbackWindow must be a positive integer");
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
