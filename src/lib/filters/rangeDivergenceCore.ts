import type { FilterEvaluation } from "@alea/lib/filters/types";
import {
  findPivotHighs,
  findPivotLows,
} from "@alea/lib/indicators/shared/pivots";
import type { MarketBar } from "@alea/lib/marketSeries/types";

export type RangeDivergenceBaseConfig = {
  readonly leftBars: number;
  readonly rightBars: number;
  readonly rangeLower: number;
  readonly rangeUpper: number;
  readonly minRangeShrinkPct: number;
  readonly requireBodyShrink: boolean;
  readonly maxSignalAgeBars: number;
};

export type RangeDivergenceTrigger = {
  readonly direction: "up" | "down";
  readonly confirmedIndex: number;
  readonly pivotIndex: number;
  readonly priorPivotIndex: number;
  readonly pivotExtreme: number;
  readonly priorPivotExtreme: number;
  readonly currentRange: number;
  readonly priorRange: number;
  readonly currentBodyPct: number;
  readonly priorBodyPct: number;
};

export type RangeDivergenceMatch =
  | {
      readonly matched: true;
      readonly bars: readonly MarketBar[];
      readonly lastIndex: number;
      readonly trigger: RangeDivergenceTrigger;
      readonly barsAgo: number;
      readonly evaluation: FilterEvaluation;
    }
  | {
      readonly matched: false;
      readonly evaluation: FilterEvaluation;
    };

export function findRecentRangeDivergence({
  bars,
  config,
}: {
  readonly bars: readonly MarketBar[];
  readonly config: RangeDivergenceBaseConfig;
}): RangeDivergenceMatch {
  validateRangeDivergenceBaseConfig(config);
  const lastIndex = bars.length - 1;
  if (lastIndex < config.leftBars + config.rightBars + config.rangeUpper) {
    return {
      matched: false,
      evaluation: {
        decision: "neutral",
        reason: "not enough bars for range divergence",
      },
    };
  }
  const lows = bars.map((b) => b.low);
  const highs = bars.map((b) => b.high);
  const pivotLows = findPivotLows({
    values: lows,
    leftBars: config.leftBars,
    rightBars: config.rightBars,
  });
  const pivotHighs = findPivotHighs({
    values: highs,
    leftBars: config.leftBars,
    rightBars: config.rightBars,
  });

  const minConfirmed = Math.max(0, lastIndex - config.maxSignalAgeBars);
  const bullish = findMostRecentRangeDivergence({
    bars,
    pivots: pivotLows,
    lastIndex,
    minConfirmed,
    config,
    direction: "up",
  });
  const bearish = findMostRecentRangeDivergence({
    bars,
    pivots: pivotHighs,
    lastIndex,
    minConfirmed,
    config,
    direction: "down",
  });

  let selected: RangeDivergenceTrigger | undefined;
  if (bullish && bearish) {
    selected =
      bullish.confirmedIndex >= bearish.confirmedIndex ? bullish : bearish;
  } else {
    selected = bullish ?? bearish;
  }
  if (selected === undefined) {
    return {
      matched: false,
      evaluation: {
        decision: "neutral",
        reason: "no range divergence inside recency window",
      },
    };
  }
  const barsAgo = lastIndex - selected.confirmedIndex;
  return {
    matched: true,
    bars,
    lastIndex,
    trigger: selected,
    barsAgo,
    evaluation: {
      decision: selected.direction,
      reason:
        selected.direction === "up"
          ? `bullish range divergence confirmed ${barsAgo} bar(s) ago`
          : `bearish range divergence confirmed ${barsAgo} bar(s) ago`,
      metadata: {
        confirmedIndex: selected.confirmedIndex,
        confirmedOpenTimeMs: bars[selected.confirmedIndex]?.openTimeMs,
        pivotIndex: selected.pivotIndex,
        priorPivotIndex: selected.priorPivotIndex,
        pivotExtreme: selected.pivotExtreme,
        priorPivotExtreme: selected.priorPivotExtreme,
        currentRange: selected.currentRange,
        priorRange: selected.priorRange,
        currentBodyPct: selected.currentBodyPct,
        priorBodyPct: selected.priorBodyPct,
        barsAgo,
      },
    },
  };
}

function findMostRecentRangeDivergence({
  bars,
  pivots,
  lastIndex,
  minConfirmed,
  config,
  direction,
}: {
  readonly bars: readonly MarketBar[];
  readonly pivots: readonly {
    readonly index: number;
    readonly value: number;
  }[];
  readonly lastIndex: number;
  readonly minConfirmed: number;
  readonly config: RangeDivergenceBaseConfig;
  readonly direction: "up" | "down";
}): RangeDivergenceTrigger | undefined {
  for (let i = pivots.length - 1; i >= 0; i -= 1) {
    const current = pivots[i]!;
    const confirmedIndex = current.index + config.rightBars;
    if (confirmedIndex > lastIndex) {
      continue;
    }
    if (confirmedIndex < minConfirmed) {
      break;
    }
    for (let j = i - 1; j >= 0; j -= 1) {
      const prior = pivots[j]!;
      const distance = current.index - prior.index;
      if (distance < config.rangeLower) {
        continue;
      }
      if (distance > config.rangeUpper) {
        break;
      }
      const trigger = checkRangeDivergence({
        bars,
        current,
        prior,
        config,
        direction,
        confirmedIndex,
      });
      if (trigger !== undefined) {
        return trigger;
      }
    }
  }
  return undefined;
}

function checkRangeDivergence({
  bars,
  current,
  prior,
  config,
  direction,
  confirmedIndex,
}: {
  readonly bars: readonly MarketBar[];
  readonly current: { readonly index: number; readonly value: number };
  readonly prior: { readonly index: number; readonly value: number };
  readonly config: RangeDivergenceBaseConfig;
  readonly direction: "up" | "down";
  readonly confirmedIndex: number;
}): RangeDivergenceTrigger | undefined {
  const currentBar = bars[current.index];
  const priorBar = bars[prior.index];
  if (currentBar === undefined || priorBar === undefined) {
    return undefined;
  }
  const currentRange = currentBar.high - currentBar.low;
  const priorRange = priorBar.high - priorBar.low;
  if (currentRange <= 0 || priorRange <= 0) {
    return undefined;
  }
  if (direction === "up" && !(current.value < prior.value)) {
    return undefined;
  }
  if (direction === "down" && !(current.value > prior.value)) {
    return undefined;
  }
  const shrinkPct = 1 - currentRange / priorRange;
  if (shrinkPct < config.minRangeShrinkPct) {
    return undefined;
  }
  const currentBodyPct =
    Math.abs(currentBar.close - currentBar.open) / currentRange;
  const priorBodyPct = Math.abs(priorBar.close - priorBar.open) / priorRange;
  if (config.requireBodyShrink && !(currentBodyPct < priorBodyPct)) {
    return undefined;
  }
  return {
    direction,
    confirmedIndex,
    pivotIndex: current.index,
    priorPivotIndex: prior.index,
    pivotExtreme: current.value,
    priorPivotExtreme: prior.value,
    currentRange,
    priorRange,
    currentBodyPct,
    priorBodyPct,
  };
}

function validateRangeDivergenceBaseConfig(
  config: RangeDivergenceBaseConfig,
): void {
  if (!Number.isInteger(config.leftBars) || config.leftBars < 1) {
    throw new Error("leftBars must be a positive integer");
  }
  if (!Number.isInteger(config.rightBars) || config.rightBars < 1) {
    throw new Error("rightBars must be a positive integer");
  }
  if (!Number.isInteger(config.rangeLower) || config.rangeLower < 1) {
    throw new Error("rangeLower must be a positive integer");
  }
  if (
    !Number.isInteger(config.rangeUpper) ||
    config.rangeUpper <= config.rangeLower
  ) {
    throw new Error("rangeUpper must be an integer > rangeLower");
  }
  if (
    !Number.isFinite(config.minRangeShrinkPct) ||
    config.minRangeShrinkPct < 0 ||
    config.minRangeShrinkPct >= 1
  ) {
    throw new Error("minRangeShrinkPct must be a number in [0, 1)");
  }
  if (
    !Number.isInteger(config.maxSignalAgeBars) ||
    config.maxSignalAgeBars < 0
  ) {
    throw new Error("maxSignalAgeBars must be a non-negative integer");
  }
}
