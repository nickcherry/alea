import type { FilterEvaluation } from "@alea/lib/filters/types";
import {
  findPivotHighs,
  findPivotLows,
} from "@alea/lib/indicators/shared/pivots";
import type { MarketBar } from "@alea/lib/marketSeries/types";

export type WickDivergenceBaseConfig = {
  readonly leftBars: number;
  readonly rightBars: number;
  readonly rangeLower: number;
  readonly rangeUpper: number;
  readonly minCurrentWickPct: number;
  readonly requireCloseLocImprovement: boolean;
  readonly maxSignalAgeBars: number;
};

export type WickDivergenceTrigger = {
  readonly direction: "up" | "down";
  readonly confirmedIndex: number;
  readonly pivotIndex: number;
  readonly priorPivotIndex: number;
  readonly pivotExtreme: number;
  readonly priorPivotExtreme: number;
  readonly currentWickPct: number;
  readonly priorWickPct: number;
};

export type WickDivergenceMatch =
  | {
      readonly matched: true;
      readonly bars: readonly MarketBar[];
      readonly lastIndex: number;
      readonly trigger: WickDivergenceTrigger;
      readonly barsAgo: number;
      readonly evaluation: FilterEvaluation;
    }
  | {
      readonly matched: false;
      readonly evaluation: FilterEvaluation;
    };

export function findRecentWickDivergence({
  bars,
  config,
}: {
  readonly bars: readonly MarketBar[];
  readonly config: WickDivergenceBaseConfig;
}): WickDivergenceMatch {
  validateWickDivergenceBaseConfig(config);
  const lastIndex = bars.length - 1;
  if (lastIndex < config.leftBars + config.rightBars + config.rangeUpper) {
    return {
      matched: false,
      evaluation: {
        decision: "neutral",
        reason: "not enough bars for wick divergence",
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
  const bullish = findMostRecentWickDivergence({
    bars,
    pivots: pivotLows,
    lastIndex,
    minConfirmed,
    config,
    direction: "up",
  });
  const bearish = findMostRecentWickDivergence({
    bars,
    pivots: pivotHighs,
    lastIndex,
    minConfirmed,
    config,
    direction: "down",
  });

  let selected: WickDivergenceTrigger | undefined;
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
        reason: "no wick divergence inside recency window",
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
          ? `bullish wick divergence confirmed ${barsAgo} bar(s) ago`
          : `bearish wick divergence confirmed ${barsAgo} bar(s) ago`,
      metadata: {
        confirmedIndex: selected.confirmedIndex,
        confirmedOpenTimeMs: bars[selected.confirmedIndex]?.openTimeMs,
        pivotIndex: selected.pivotIndex,
        priorPivotIndex: selected.priorPivotIndex,
        pivotExtreme: selected.pivotExtreme,
        priorPivotExtreme: selected.priorPivotExtreme,
        currentWickPct: selected.currentWickPct,
        priorWickPct: selected.priorWickPct,
        barsAgo,
      },
    },
  };
}

function findMostRecentWickDivergence({
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
  readonly config: WickDivergenceBaseConfig;
  readonly direction: "up" | "down";
}): WickDivergenceTrigger | undefined {
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
      const trigger = checkDivergence({
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

function checkDivergence({
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
  readonly config: WickDivergenceBaseConfig;
  readonly direction: "up" | "down";
  readonly confirmedIndex: number;
}): WickDivergenceTrigger | undefined {
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
  let currentWickPct: number;
  let priorWickPct: number;
  let currentCloseLoc: number;
  let priorCloseLoc: number;
  if (direction === "up") {
    if (!(current.value < prior.value)) {
      return undefined;
    }
    currentWickPct =
      (Math.min(currentBar.open, currentBar.close) - currentBar.low) /
      currentRange;
    priorWickPct =
      (Math.min(priorBar.open, priorBar.close) - priorBar.low) / priorRange;
    currentCloseLoc = (currentBar.close - currentBar.low) / currentRange;
    priorCloseLoc = (priorBar.close - priorBar.low) / priorRange;
  } else {
    if (!(current.value > prior.value)) {
      return undefined;
    }
    currentWickPct =
      (currentBar.high - Math.max(currentBar.open, currentBar.close)) /
      currentRange;
    priorWickPct =
      (priorBar.high - Math.max(priorBar.open, priorBar.close)) / priorRange;
    currentCloseLoc = (currentBar.close - currentBar.low) / currentRange;
    priorCloseLoc = (priorBar.close - priorBar.low) / priorRange;
  }
  if (currentWickPct < config.minCurrentWickPct) {
    return undefined;
  }
  if (!(currentWickPct > priorWickPct)) {
    return undefined;
  }
  if (config.requireCloseLocImprovement) {
    if (direction === "up" && !(currentCloseLoc > priorCloseLoc)) {
      return undefined;
    }
    if (direction === "down" && !(currentCloseLoc < priorCloseLoc)) {
      return undefined;
    }
  }
  return {
    direction,
    confirmedIndex,
    pivotIndex: current.index,
    priorPivotIndex: prior.index,
    pivotExtreme: current.value,
    priorPivotExtreme: prior.value,
    currentWickPct,
    priorWickPct,
  };
}

function validateWickDivergenceBaseConfig(
  config: WickDivergenceBaseConfig,
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
    !Number.isFinite(config.minCurrentWickPct) ||
    config.minCurrentWickPct < 0 ||
    config.minCurrentWickPct > 0.5
  ) {
    throw new Error("minCurrentWickPct must be a number in [0, 0.5]");
  }
  if (
    !Number.isInteger(config.maxSignalAgeBars) ||
    config.maxSignalAgeBars < 0
  ) {
    throw new Error("maxSignalAgeBars must be a non-negative integer");
  }
}
