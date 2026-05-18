import type { FilterEvaluation } from "@alea/lib/filters/types";
import type { MarketBar } from "@alea/lib/marketSeries/types";

export type HtfAlignmentBaseConfig = {
  readonly htfWindow: number;
  readonly minReturnPct: number;
  readonly maxSignalAgeBars: number;
  readonly requireSynthAlignment: boolean;
};

export type HtfAlignmentTrigger = {
  readonly direction: "up" | "down";
  readonly confirmedIndex: number;
  readonly htfReturnPct: number;
  readonly synthDirection: "up" | "down" | "flat";
};

export type HtfAlignmentMatch =
  | {
      readonly matched: true;
      readonly bars: readonly MarketBar[];
      readonly lastIndex: number;
      readonly trigger: HtfAlignmentTrigger;
      readonly barsAgo: number;
      readonly evaluation: FilterEvaluation;
    }
  | {
      readonly matched: false;
      readonly evaluation: FilterEvaluation;
    };

export function findRecentHtfAlignment({
  bars,
  config,
}: {
  readonly bars: readonly MarketBar[];
  readonly config: HtfAlignmentBaseConfig;
}): HtfAlignmentMatch {
  validateHtfAlignmentBaseConfig(config);
  const lastIndex = bars.length - 1;
  if (lastIndex < config.htfWindow) {
    return {
      matched: false,
      evaluation: {
        decision: "neutral",
        reason: "not enough bars for HTF alignment",
      },
    };
  }
  const earliest = Math.max(
    config.htfWindow,
    lastIndex - config.maxSignalAgeBars,
  );
  for (let i = lastIndex; i >= earliest; i -= 1) {
    const trigger = detectHtfAlignmentAt({ bars, index: i, config });
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
            ? `htf alignment long: ${config.htfWindow}-bar return ${(100 * trigger.htfReturnPct).toFixed(2)}%`
            : `htf alignment short: ${config.htfWindow}-bar return ${(100 * trigger.htfReturnPct).toFixed(2)}%`,
        metadata: {
          confirmedIndex: trigger.confirmedIndex,
          confirmedOpenTimeMs: bars[trigger.confirmedIndex]?.openTimeMs,
          htfReturnPct: trigger.htfReturnPct,
          synthDirection: trigger.synthDirection,
          barsAgo,
        },
      },
    };
  }
  return {
    matched: false,
    evaluation: {
      decision: "neutral",
      reason: "no HTF alignment trigger inside recency window",
    },
  };
}

export function detectHtfAlignmentAt({
  bars,
  index,
  config,
}: {
  readonly bars: readonly MarketBar[];
  readonly index: number;
  readonly config: HtfAlignmentBaseConfig;
}): HtfAlignmentTrigger | undefined {
  const bar = bars[index];
  const startBar = bars[index - config.htfWindow];
  if (bar === undefined || startBar === undefined) {
    return undefined;
  }
  if (startBar.open <= 0) {
    return undefined;
  }
  const htfReturnPct = (bar.close - startBar.open) / startBar.open;
  if (Math.abs(htfReturnPct) < config.minReturnPct) {
    return undefined;
  }
  const synthDirection: "up" | "down" | "flat" =
    bar.close > bar.open ? "up" : bar.close < bar.open ? "down" : "flat";
  const direction: "up" | "down" = htfReturnPct > 0 ? "up" : "down";
  if (config.requireSynthAlignment && synthDirection !== direction) {
    return undefined;
  }
  return {
    direction,
    confirmedIndex: index,
    htfReturnPct,
    synthDirection,
  };
}

function validateHtfAlignmentBaseConfig(config: HtfAlignmentBaseConfig): void {
  if (!Number.isInteger(config.htfWindow) || config.htfWindow < 2) {
    throw new Error("htfWindow must be an integer >= 2");
  }
  if (!Number.isFinite(config.minReturnPct) || config.minReturnPct < 0) {
    throw new Error("minReturnPct must be a non-negative number");
  }
  if (
    !Number.isInteger(config.maxSignalAgeBars) ||
    config.maxSignalAgeBars < 0
  ) {
    throw new Error("maxSignalAgeBars must be a non-negative integer");
  }
}
