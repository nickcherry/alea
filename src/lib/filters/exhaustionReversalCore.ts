import type { FilterEvaluation } from "@alea/lib/filters/types";
import { computeEmaSeries } from "@alea/lib/indicators/ema";
import type { MarketBar } from "@alea/lib/marketSeries/types";

export type ExhaustionReversalBaseConfig = {
  readonly emaLength: number;
  readonly runWindow: number;
  readonly minDirectionalCount: number;
  readonly minRunReturnPct: number;
  readonly minDistanceFromEmaPct: number;
  readonly minWickPct: number;
  readonly maxCloseLocation: number;
  readonly requireBodyShrink: boolean;
  readonly maxSignalAgeBars: number;
};

export type ExhaustionReversalTrigger = {
  readonly direction: "up" | "down";
  readonly confirmedIndex: number;
  readonly runDirectionCount: number;
  readonly runReturnPct: number;
  readonly emaDistancePct: number;
  readonly wickPct: number;
  readonly closeLocation: number;
  readonly bodyPct: number;
  readonly priorBodyPct: number;
  readonly exhaustionExtreme: number;
};

export type ExhaustionReversalMatch =
  | {
      readonly matched: true;
      readonly bars: readonly MarketBar[];
      readonly lastIndex: number;
      readonly trigger: ExhaustionReversalTrigger;
      readonly emaSeries: readonly (number | null)[];
      readonly barsAgo: number;
      readonly evaluation: FilterEvaluation;
    }
  | {
      readonly matched: false;
      readonly evaluation: FilterEvaluation;
    };

export function findRecentExhaustionReversal({
  bars,
  config,
}: {
  readonly bars: readonly MarketBar[];
  readonly config: ExhaustionReversalBaseConfig;
}): ExhaustionReversalMatch {
  validateExhaustionReversalBaseConfig(config);
  const lastIndex = bars.length - 1;
  const minBars = config.emaLength + config.runWindow + 1;
  if (lastIndex < minBars) {
    return {
      matched: false,
      evaluation: {
        decision: "neutral",
        reason: "not enough bars for exhaustion reversal",
      },
    };
  }
  const closes = bars.map((bar) => bar.close);
  const emaSeries = computeEmaSeries({
    closes,
    period: config.emaLength,
  });

  const earliest = Math.max(minBars, lastIndex - config.maxSignalAgeBars);
  for (let i = lastIndex; i >= earliest; i -= 1) {
    const trigger = detectExhaustionReversalAt({
      bars,
      index: i,
      emaSeries,
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
      emaSeries,
      barsAgo,
      evaluation: {
        decision: trigger.direction,
        reason:
          trigger.direction === "up"
            ? `exhaustion reversal long confirmed ${barsAgo} bar(s) ago`
            : `exhaustion reversal short confirmed ${barsAgo} bar(s) ago`,
        metadata: {
          confirmedIndex: trigger.confirmedIndex,
          confirmedOpenTimeMs: bars[trigger.confirmedIndex]?.openTimeMs,
          runDirectionCount: trigger.runDirectionCount,
          runReturnPct: trigger.runReturnPct,
          emaDistancePct: trigger.emaDistancePct,
          wickPct: trigger.wickPct,
          closeLocation: trigger.closeLocation,
          bodyPct: trigger.bodyPct,
          priorBodyPct: trigger.priorBodyPct,
          exhaustionExtreme: trigger.exhaustionExtreme,
          barsAgo,
        },
      },
    };
  }
  return {
    matched: false,
    evaluation: {
      decision: "neutral",
      reason: "no exhaustion reversal trigger inside recency window",
    },
  };
}

export function detectExhaustionReversalAt({
  bars,
  index,
  emaSeries,
  config,
}: {
  readonly bars: readonly MarketBar[];
  readonly index: number;
  readonly emaSeries: readonly (number | null)[];
  readonly config: ExhaustionReversalBaseConfig;
}): ExhaustionReversalTrigger | undefined {
  const bar = bars[index];
  const prior = bars[index - 1];
  const ema = emaSeries[index];
  if (bar === undefined || prior === undefined || ema == null) {
    return undefined;
  }
  const range = bar.high - bar.low;
  if (range <= 0) {
    return undefined;
  }
  const priorRange = prior.high - prior.low;
  if (priorRange <= 0) {
    return undefined;
  }
  const closeLocation = (bar.close - bar.low) / range;
  const bodyPct = Math.abs(bar.close - bar.open) / range;
  const priorBodyPct = Math.abs(prior.close - prior.open) / priorRange;
  if (config.requireBodyShrink && bodyPct >= priorBodyPct) {
    return undefined;
  }

  const runStart = index - config.runWindow;
  if (runStart < 0) {
    return undefined;
  }
  let greenCount = 0;
  let redCount = 0;
  for (let j = runStart; j < index; j += 1) {
    const prev = bars[j];
    if (prev === undefined) {
      return undefined;
    }
    if (prev.close > prev.open) {
      greenCount += 1;
    } else if (prev.close < prev.open) {
      redCount += 1;
    }
  }
  const runStartBar = bars[runStart];
  const lastRunBar = bars[index - 1];
  if (runStartBar === undefined || lastRunBar === undefined) {
    return undefined;
  }
  const runReturnPct = (lastRunBar.close - runStartBar.open) / runStartBar.open;
  const upperWickPct = (bar.high - Math.max(bar.open, bar.close)) / range;
  const lowerWickPct = (Math.min(bar.open, bar.close) - bar.low) / range;
  const emaDistancePct = (bar.close - ema) / ema;

  if (greenCount >= config.minDirectionalCount) {
    if (
      runReturnPct >= config.minRunReturnPct &&
      emaDistancePct >= config.minDistanceFromEmaPct &&
      upperWickPct >= config.minWickPct &&
      closeLocation <= config.maxCloseLocation
    ) {
      return {
        direction: "down",
        confirmedIndex: index,
        runDirectionCount: greenCount,
        runReturnPct,
        emaDistancePct,
        wickPct: upperWickPct,
        closeLocation,
        bodyPct,
        priorBodyPct,
        exhaustionExtreme: bar.high,
      };
    }
  }
  if (redCount >= config.minDirectionalCount) {
    if (
      runReturnPct <= -config.minRunReturnPct &&
      emaDistancePct <= -config.minDistanceFromEmaPct &&
      lowerWickPct >= config.minWickPct &&
      closeLocation >= 1 - config.maxCloseLocation
    ) {
      return {
        direction: "up",
        confirmedIndex: index,
        runDirectionCount: redCount,
        runReturnPct,
        emaDistancePct,
        wickPct: lowerWickPct,
        closeLocation,
        bodyPct,
        priorBodyPct,
        exhaustionExtreme: bar.low,
      };
    }
  }
  return undefined;
}

function validateExhaustionReversalBaseConfig(
  config: ExhaustionReversalBaseConfig,
): void {
  if (!Number.isInteger(config.emaLength) || config.emaLength < 2) {
    throw new Error("emaLength must be an integer >= 2");
  }
  if (!Number.isInteger(config.runWindow) || config.runWindow < 3) {
    throw new Error("runWindow must be an integer >= 3");
  }
  if (
    !Number.isInteger(config.minDirectionalCount) ||
    config.minDirectionalCount < 1 ||
    config.minDirectionalCount > config.runWindow
  ) {
    throw new Error(
      "minDirectionalCount must be a positive integer <= runWindow",
    );
  }
  if (!Number.isFinite(config.minRunReturnPct) || config.minRunReturnPct <= 0) {
    throw new Error("minRunReturnPct must be a positive number");
  }
  if (
    !Number.isFinite(config.minDistanceFromEmaPct) ||
    config.minDistanceFromEmaPct < 0
  ) {
    throw new Error("minDistanceFromEmaPct must be a non-negative number");
  }
  if (
    !Number.isFinite(config.minWickPct) ||
    config.minWickPct < 0 ||
    config.minWickPct > 0.5
  ) {
    throw new Error("minWickPct must be a number in [0, 0.5]");
  }
  if (
    !Number.isFinite(config.maxCloseLocation) ||
    config.maxCloseLocation <= 0 ||
    config.maxCloseLocation >= 0.5
  ) {
    throw new Error("maxCloseLocation must be a number in (0, 0.5)");
  }
  if (
    !Number.isInteger(config.maxSignalAgeBars) ||
    config.maxSignalAgeBars < 0
  ) {
    throw new Error("maxSignalAgeBars must be a non-negative integer");
  }
}
