import type { FilterEvaluation } from "@alea/lib/filters/types";
import {
  findPivotHighs,
  findPivotLows,
} from "@alea/lib/indicators/shared/pivots";
import type { MarketBar } from "@alea/lib/marketSeries/types";

export type BodyDivergenceBaseConfig = {
  readonly leftBars: number;
  readonly rightBars: number;
  readonly rangeLower: number;
  readonly rangeUpper: number;
  readonly minBodyShrinkPct: number;
  readonly maxSignalAgeBars: number;
};

export type BodyDivergenceTrigger = {
  readonly direction: "up" | "down";
  readonly confirmedIndex: number;
  readonly pivotIndex: number;
  readonly priorPivotIndex: number;
  readonly pivotExtreme: number;
  readonly priorPivotExtreme: number;
  readonly currentBody: number;
  readonly priorBody: number;
};

export type BodyDivergenceMatch =
  | {
      readonly matched: true;
      readonly bars: readonly MarketBar[];
      readonly lastIndex: number;
      readonly trigger: BodyDivergenceTrigger;
      readonly barsAgo: number;
      readonly evaluation: FilterEvaluation;
    }
  | {
      readonly matched: false;
      readonly evaluation: FilterEvaluation;
    };

export function findRecentBodyDivergence({
  bars,
  config,
}: {
  readonly bars: readonly MarketBar[];
  readonly config: BodyDivergenceBaseConfig;
}): BodyDivergenceMatch {
  validateBodyDivergenceBaseConfig(config);
  const lastIndex = bars.length - 1;
  if (lastIndex < config.leftBars + config.rightBars + config.rangeUpper) {
    return {
      matched: false,
      evaluation: {
        decision: "neutral",
        reason: "not enough bars for body divergence",
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
  const bullish = findMostRecent({
    bars,
    pivots: pivotLows,
    lastIndex,
    minConfirmed,
    config,
    direction: "up",
  });
  const bearish = findMostRecent({
    bars,
    pivots: pivotHighs,
    lastIndex,
    minConfirmed,
    config,
    direction: "down",
  });

  let selected: BodyDivergenceTrigger | undefined;
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
        reason: "no body divergence inside recency window",
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
          ? `bullish body divergence confirmed ${barsAgo} bar(s) ago`
          : `bearish body divergence confirmed ${barsAgo} bar(s) ago`,
      metadata: {
        confirmedIndex: selected.confirmedIndex,
        confirmedOpenTimeMs: bars[selected.confirmedIndex]?.openTimeMs,
        pivotIndex: selected.pivotIndex,
        priorPivotIndex: selected.priorPivotIndex,
        pivotExtreme: selected.pivotExtreme,
        priorPivotExtreme: selected.priorPivotExtreme,
        currentBody: selected.currentBody,
        priorBody: selected.priorBody,
        barsAgo,
      },
    },
  };
}

function findMostRecent({
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
  readonly config: BodyDivergenceBaseConfig;
  readonly direction: "up" | "down";
}): BodyDivergenceTrigger | undefined {
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
      const trigger = check({
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

function check({
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
  readonly config: BodyDivergenceBaseConfig;
  readonly direction: "up" | "down";
  readonly confirmedIndex: number;
}): BodyDivergenceTrigger | undefined {
  const currentBar = bars[current.index];
  const priorBar = bars[prior.index];
  if (currentBar === undefined || priorBar === undefined) {
    return undefined;
  }
  if (direction === "up" && !(current.value < prior.value)) {
    return undefined;
  }
  if (direction === "down" && !(current.value > prior.value)) {
    return undefined;
  }
  const currentBody = Math.abs(currentBar.close - currentBar.open);
  const priorBody = Math.abs(priorBar.close - priorBar.open);
  if (priorBody <= 0) {
    return undefined;
  }
  const shrinkPct = 1 - currentBody / priorBody;
  if (shrinkPct < config.minBodyShrinkPct) {
    return undefined;
  }
  return {
    direction,
    confirmedIndex,
    pivotIndex: current.index,
    priorPivotIndex: prior.index,
    pivotExtreme: current.value,
    priorPivotExtreme: prior.value,
    currentBody,
    priorBody,
  };
}

function validateBodyDivergenceBaseConfig(
  config: BodyDivergenceBaseConfig,
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
    !Number.isFinite(config.minBodyShrinkPct) ||
    config.minBodyShrinkPct < 0 ||
    config.minBodyShrinkPct >= 1
  ) {
    throw new Error("minBodyShrinkPct must be a number in [0, 1)");
  }
  if (
    !Number.isInteger(config.maxSignalAgeBars) ||
    config.maxSignalAgeBars < 0
  ) {
    throw new Error("maxSignalAgeBars must be a non-negative integer");
  }
}
