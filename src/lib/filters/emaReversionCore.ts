import type { FilterEvaluation } from "@alea/lib/filters/types";
import { computeEmaSeries } from "@alea/lib/indicators/ema";
import type { MarketBar } from "@alea/lib/marketSeries/types";

export type EmaReversionBaseConfig = {
  readonly emaLength: number;
  readonly minDistancePct: number;
  readonly minBodyPct: number;
  readonly maxSignalAgeBars: number;
};

export type EmaReversionTrigger = {
  readonly direction: "up" | "down";
  readonly confirmedIndex: number;
  readonly ema: number;
  readonly distancePct: number;
  readonly bodyPct: number;
  readonly extremeExtreme: number;
};

export type EmaReversionMatch =
  | {
      readonly matched: true;
      readonly bars: readonly MarketBar[];
      readonly lastIndex: number;
      readonly trigger: EmaReversionTrigger;
      readonly emaSeries: readonly (number | null)[];
      readonly barsAgo: number;
      readonly evaluation: FilterEvaluation;
    }
  | {
      readonly matched: false;
      readonly evaluation: FilterEvaluation;
    };

export function findRecentEmaReversion({
  bars,
  config,
}: {
  readonly bars: readonly MarketBar[];
  readonly config: EmaReversionBaseConfig;
}): EmaReversionMatch {
  validateEmaReversionBaseConfig(config);
  const lastIndex = bars.length - 1;
  if (lastIndex < config.emaLength) {
    return {
      matched: false,
      evaluation: {
        decision: "neutral",
        reason: "not enough bars for EMA reversion",
      },
    };
  }
  const closes = bars.map((b) => b.close);
  const emaSeries = computeEmaSeries({ closes, period: config.emaLength });
  const earliest = Math.max(
    config.emaLength,
    lastIndex - config.maxSignalAgeBars,
  );
  for (let i = lastIndex; i >= earliest; i -= 1) {
    const trigger = detectEmaReversionAt({ bars, index: i, emaSeries, config });
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
            ? `price stretched ${(100 * trigger.distancePct).toFixed(2)}% below EMA → bet up (mean reversion)`
            : `price stretched ${(100 * trigger.distancePct).toFixed(2)}% above EMA → bet down (mean reversion)`,
        metadata: {
          confirmedIndex: trigger.confirmedIndex,
          confirmedOpenTimeMs: bars[trigger.confirmedIndex]?.openTimeMs,
          ema: trigger.ema,
          distancePct: trigger.distancePct,
          bodyPct: trigger.bodyPct,
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
      reason: "no EMA reversion trigger inside recency window",
    },
  };
}

export function detectEmaReversionAt({
  bars,
  index,
  emaSeries,
  config,
}: {
  readonly bars: readonly MarketBar[];
  readonly index: number;
  readonly emaSeries: readonly (number | null)[];
  readonly config: EmaReversionBaseConfig;
}): EmaReversionTrigger | undefined {
  const bar = bars[index];
  const ema = emaSeries[index];
  if (bar === undefined || ema == null) {
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
  const distancePct = (bar.close - ema) / ema;
  if (distancePct >= config.minDistancePct) {
    return {
      direction: "down",
      confirmedIndex: index,
      ema,
      distancePct,
      bodyPct,
      extremeExtreme: bar.high,
    };
  }
  if (distancePct <= -config.minDistancePct) {
    return {
      direction: "up",
      confirmedIndex: index,
      ema,
      distancePct,
      bodyPct,
      extremeExtreme: bar.low,
    };
  }
  return undefined;
}

function validateEmaReversionBaseConfig(config: EmaReversionBaseConfig): void {
  if (!Number.isInteger(config.emaLength) || config.emaLength < 2) {
    throw new Error("emaLength must be an integer >= 2");
  }
  if (
    !Number.isFinite(config.minDistancePct) ||
    config.minDistancePct <= 0 ||
    config.minDistancePct > 0.2
  ) {
    throw new Error("minDistancePct must be a number in (0, 0.2]");
  }
  if (
    !Number.isFinite(config.minBodyPct) ||
    config.minBodyPct < 0 ||
    config.minBodyPct >= 1
  ) {
    throw new Error("minBodyPct must be a number in [0, 1)");
  }
  if (
    !Number.isInteger(config.maxSignalAgeBars) ||
    config.maxSignalAgeBars < 0
  ) {
    throw new Error("maxSignalAgeBars must be a non-negative integer");
  }
}
