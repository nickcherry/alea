import type { FilterEvaluation } from "@alea/lib/filters/types";
import { computeEmaSeries } from "@alea/lib/indicators/ema";
import type { MarketBar } from "@alea/lib/marketSeries/types";

export type AmbiguousTrendBaseConfig = {
  readonly fastEmaLength: number;
  readonly slowEmaLength: number;
  readonly slopeLookback: number;
  readonly minSlopePct: number;
  readonly maxBodyPct: number;
  readonly minCloseLocation: number;
  readonly maxCloseLocation: number;
  readonly requireCloseAcrossSlowEma: boolean;
};

export type AmbiguousTrendTrigger = {
  readonly direction: "up" | "down";
  readonly confirmedIndex: number;
  readonly fastEma: number;
  readonly slowEma: number;
  readonly slopePct: number;
  readonly bodyPct: number;
  readonly closeLocation: number;
};

export type AmbiguousTrendMatch =
  | {
      readonly matched: true;
      readonly bars: readonly MarketBar[];
      readonly lastIndex: number;
      readonly trigger: AmbiguousTrendTrigger;
      readonly fastEmaSeries: readonly (number | null)[];
      readonly slowEmaSeries: readonly (number | null)[];
      readonly evaluation: FilterEvaluation;
    }
  | {
      readonly matched: false;
      readonly evaluation: FilterEvaluation;
    };

export function findAmbiguousTrendMatch({
  bars,
  config,
}: {
  readonly bars: readonly MarketBar[];
  readonly config: AmbiguousTrendBaseConfig;
}): AmbiguousTrendMatch {
  validateAmbiguousTrendBaseConfig(config);
  const lastIndex = bars.length - 1;
  if (lastIndex < config.slowEmaLength + config.slopeLookback) {
    return {
      matched: false,
      evaluation: {
        decision: "neutral",
        reason: "not enough bars for ambiguous trend filter",
      },
    };
  }
  const closes = bars.map((b) => b.close);
  const fastEmaSeries = computeEmaSeries({
    closes,
    period: config.fastEmaLength,
  });
  const slowEmaSeries = computeEmaSeries({
    closes,
    period: config.slowEmaLength,
  });

  const bar = bars[lastIndex];
  const fastEma = fastEmaSeries[lastIndex];
  const slowEma = slowEmaSeries[lastIndex];
  const priorFastEma = fastEmaSeries[lastIndex - config.slopeLookback];
  if (
    bar === undefined ||
    fastEma == null ||
    slowEma == null ||
    priorFastEma == null
  ) {
    return {
      matched: false,
      evaluation: {
        decision: "neutral",
        reason: "missing inputs for ambiguous trend filter",
      },
    };
  }
  const range = bar.high - bar.low;
  if (range <= 0) {
    return {
      matched: false,
      evaluation: { decision: "neutral", reason: "synth bar has zero range" },
    };
  }
  const bodyPct = Math.abs(bar.close - bar.open) / range;
  const closeLocation = (bar.close - bar.low) / range;
  if (bodyPct > config.maxBodyPct) {
    return {
      matched: false,
      evaluation: {
        decision: "neutral",
        reason: "synth bar is not ambiguous (body too large)",
      },
    };
  }
  if (
    closeLocation < config.minCloseLocation ||
    closeLocation > config.maxCloseLocation
  ) {
    return {
      matched: false,
      evaluation: {
        decision: "neutral",
        reason: "synth close-location not in ambiguous window",
      },
    };
  }

  const slopePct = (fastEma - priorFastEma) / priorFastEma;
  const upTrend =
    fastEma > slowEma &&
    slopePct >= config.minSlopePct &&
    (!config.requireCloseAcrossSlowEma || bar.close > slowEma);
  const downTrend =
    fastEma < slowEma &&
    slopePct <= -config.minSlopePct &&
    (!config.requireCloseAcrossSlowEma || bar.close < slowEma);
  if (!upTrend && !downTrend) {
    return {
      matched: false,
      evaluation: { decision: "neutral", reason: "no qualifying trend regime" },
    };
  }

  const direction: "up" | "down" = upTrend ? "up" : "down";
  return {
    matched: true,
    bars,
    lastIndex,
    fastEmaSeries,
    slowEmaSeries,
    trigger: {
      direction,
      confirmedIndex: lastIndex,
      fastEma,
      slowEma,
      slopePct,
      bodyPct,
      closeLocation,
    },
    evaluation: {
      decision: direction,
      reason:
        direction === "up"
          ? `ambiguous synth + uptrend regime → bet up`
          : `ambiguous synth + downtrend regime → bet down`,
      metadata: {
        confirmedIndex: lastIndex,
        confirmedOpenTimeMs: bar.openTimeMs,
        fastEma,
        slowEma,
        slopePct,
        bodyPct,
        closeLocation,
      },
    },
  };
}

function validateAmbiguousTrendBaseConfig(
  config: AmbiguousTrendBaseConfig,
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
  if (!Number.isFinite(config.minSlopePct) || config.minSlopePct < 0) {
    throw new Error("minSlopePct must be a non-negative number");
  }
  if (
    !Number.isFinite(config.maxBodyPct) ||
    config.maxBodyPct <= 0 ||
    config.maxBodyPct >= 1
  ) {
    throw new Error("maxBodyPct must be a number in (0, 1)");
  }
  if (
    !Number.isFinite(config.minCloseLocation) ||
    config.minCloseLocation < 0 ||
    config.minCloseLocation >= config.maxCloseLocation
  ) {
    throw new Error(
      "minCloseLocation must be a number in [0, maxCloseLocation)",
    );
  }
  if (
    !Number.isFinite(config.maxCloseLocation) ||
    config.maxCloseLocation > 1
  ) {
    throw new Error(
      "maxCloseLocation must be a number in (minCloseLocation, 1]",
    );
  }
}
