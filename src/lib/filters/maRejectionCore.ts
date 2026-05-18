import type { FilterEvaluation } from "@alea/lib/filters/types";
import { computeEmaSeries } from "@alea/lib/indicators/ema";
import type { MarketBar } from "@alea/lib/marketSeries/types";

export type MaRejectionBaseConfig = {
  readonly fastEmaLength: number;
  readonly midEmaLength: number;
  readonly slowEmaLength: number;
  readonly touchTolerancePct: number;
  readonly minLowerWickPct: number;
  readonly minCloseLocation: number;
  readonly maxSignalAgeBars: number;
};

export type MaRejectionTrigger = {
  readonly direction: "up" | "down";
  readonly confirmedIndex: number;
  readonly fastEma: number;
  readonly midEma: number;
  readonly slowEma: number;
  readonly touchLevel: number;
  readonly wickPct: number;
  readonly closeLocation: number;
};

export type MaRejectionMatch =
  | {
      readonly matched: true;
      readonly bars: readonly MarketBar[];
      readonly lastIndex: number;
      readonly trigger: MaRejectionTrigger;
      readonly fastEmaSeries: readonly (number | null)[];
      readonly midEmaSeries: readonly (number | null)[];
      readonly slowEmaSeries: readonly (number | null)[];
      readonly barsAgo: number;
      readonly evaluation: FilterEvaluation;
    }
  | {
      readonly matched: false;
      readonly evaluation: FilterEvaluation;
    };

export function findRecentMaRejection({
  bars,
  config,
}: {
  readonly bars: readonly MarketBar[];
  readonly config: MaRejectionBaseConfig;
}): MaRejectionMatch {
  validateMaRejectionBaseConfig(config);
  const lastIndex = bars.length - 1;
  if (lastIndex < config.slowEmaLength) {
    return {
      matched: false,
      evaluation: {
        decision: "neutral",
        reason: "not enough bars for MA rejection",
      },
    };
  }
  const closes = bars.map((b) => b.close);
  const fastEmaSeries = computeEmaSeries({
    closes,
    period: config.fastEmaLength,
  });
  const midEmaSeries = computeEmaSeries({
    closes,
    period: config.midEmaLength,
  });
  const slowEmaSeries = computeEmaSeries({
    closes,
    period: config.slowEmaLength,
  });
  const earliest = Math.max(
    config.slowEmaLength,
    lastIndex - config.maxSignalAgeBars,
  );
  for (let i = lastIndex; i >= earliest; i -= 1) {
    const trigger = detectMaRejectionAt({
      bars,
      index: i,
      fastEmaSeries,
      midEmaSeries,
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
      midEmaSeries,
      slowEmaSeries,
      barsAgo,
      evaluation: {
        decision: trigger.direction,
        reason:
          trigger.direction === "up"
            ? `MA rejection long confirmed ${barsAgo} bar(s) ago`
            : `MA rejection short confirmed ${barsAgo} bar(s) ago`,
        metadata: {
          confirmedIndex: trigger.confirmedIndex,
          confirmedOpenTimeMs: bars[trigger.confirmedIndex]?.openTimeMs,
          fastEma: trigger.fastEma,
          midEma: trigger.midEma,
          slowEma: trigger.slowEma,
          touchLevel: trigger.touchLevel,
          wickPct: trigger.wickPct,
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
      reason: "no MA rejection trigger inside recency window",
    },
  };
}

export function detectMaRejectionAt({
  bars,
  index,
  fastEmaSeries,
  midEmaSeries,
  slowEmaSeries,
  config,
}: {
  readonly bars: readonly MarketBar[];
  readonly index: number;
  readonly fastEmaSeries: readonly (number | null)[];
  readonly midEmaSeries: readonly (number | null)[];
  readonly slowEmaSeries: readonly (number | null)[];
  readonly config: MaRejectionBaseConfig;
}): MaRejectionTrigger | undefined {
  const bar = bars[index];
  const fast = fastEmaSeries[index];
  const mid = midEmaSeries[index];
  const slow = slowEmaSeries[index];
  if (bar === undefined || fast == null || mid == null || slow == null) {
    return undefined;
  }
  const range = bar.high - bar.low;
  if (range <= 0) {
    return undefined;
  }
  const closeLocation = (bar.close - bar.low) / range;
  const upperWickPct = (bar.high - Math.max(bar.open, bar.close)) / range;
  const lowerWickPct = (Math.min(bar.open, bar.close) - bar.low) / range;
  const tolerance = config.touchTolerancePct;

  if (fast > mid && mid > slow) {
    const fastTouched = bar.low <= fast * (1 + tolerance);
    const midTouched = bar.low <= mid * (1 + tolerance);
    if (
      (fastTouched || midTouched) &&
      bar.close > fast &&
      lowerWickPct >= config.minLowerWickPct &&
      closeLocation >= config.minCloseLocation
    ) {
      return {
        direction: "up",
        confirmedIndex: index,
        fastEma: fast,
        midEma: mid,
        slowEma: slow,
        touchLevel: fastTouched ? fast : mid,
        wickPct: lowerWickPct,
        closeLocation,
      };
    }
  }
  if (fast < mid && mid < slow) {
    const fastTouched = bar.high >= fast * (1 - tolerance);
    const midTouched = bar.high >= mid * (1 - tolerance);
    if (
      (fastTouched || midTouched) &&
      bar.close < fast &&
      upperWickPct >= config.minLowerWickPct &&
      closeLocation <= 1 - config.minCloseLocation
    ) {
      return {
        direction: "down",
        confirmedIndex: index,
        fastEma: fast,
        midEma: mid,
        slowEma: slow,
        touchLevel: fastTouched ? fast : mid,
        wickPct: upperWickPct,
        closeLocation,
      };
    }
  }
  return undefined;
}

function validateMaRejectionBaseConfig(config: MaRejectionBaseConfig): void {
  if (!Number.isInteger(config.fastEmaLength) || config.fastEmaLength < 2) {
    throw new Error("fastEmaLength must be an integer >= 2");
  }
  if (
    !Number.isInteger(config.midEmaLength) ||
    config.midEmaLength <= config.fastEmaLength
  ) {
    throw new Error("midEmaLength must be an integer > fastEmaLength");
  }
  if (
    !Number.isInteger(config.slowEmaLength) ||
    config.slowEmaLength <= config.midEmaLength
  ) {
    throw new Error("slowEmaLength must be an integer > midEmaLength");
  }
  if (
    !Number.isFinite(config.touchTolerancePct) ||
    config.touchTolerancePct < 0 ||
    config.touchTolerancePct > 0.05
  ) {
    throw new Error("touchTolerancePct must be a number in [0, 0.05]");
  }
  if (
    !Number.isFinite(config.minLowerWickPct) ||
    config.minLowerWickPct < 0 ||
    config.minLowerWickPct > 0.5
  ) {
    throw new Error("minLowerWickPct must be a number in [0, 0.5]");
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
