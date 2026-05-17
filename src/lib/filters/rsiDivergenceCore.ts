import type { FilterDecision, FilterEvaluation } from "@alea/lib/filters/types";
import { computeWilderRsiSeries } from "@alea/lib/indicators/rsi";
import {
  computeRsiDivergenceSignals,
  type RsiDivergenceKind,
  type RsiDivergenceSignal,
} from "@alea/lib/indicators/rsiDivergence";
import type {
  AlignedMarketSeries,
  MarketBar,
} from "@alea/lib/marketSeries/types";

export type RsiDivergenceBaseConfig = {
  readonly rsiLength: number;
  readonly includeHidden: boolean;
  readonly leftBars: number;
  readonly rightBars: number;
  readonly rangeLower: number;
  readonly rangeUpper: number;
  readonly minSignalAgeBars?: number;
  readonly maxSignalAgeBars: number;
};

export type RsiDivergenceMatch =
  | {
      readonly matched: true;
      readonly bars: readonly MarketBar[];
      readonly lastIndex: number;
      readonly signal: RsiDivergenceSignal;
      readonly decision: Exclude<FilterDecision, "neutral">;
      readonly barsAgo: number;
      readonly evaluation: FilterEvaluation;
    }
  | {
      readonly matched: false;
      readonly evaluation: FilterEvaluation;
    };

type CachedRsiDivergenceSignals = {
  readonly bars: readonly MarketBar[];
  readonly lastIndex: number;
  readonly signals: readonly RsiDivergenceSignal[];
};

const signalCache = new WeakMap<
  AlignedMarketSeries,
  Map<string, CachedRsiDivergenceSignals>
>();

export function findRecentRsiDivergenceMatch({
  series,
  config,
}: {
  readonly series: AlignedMarketSeries;
  readonly config: RsiDivergenceBaseConfig;
}): RsiDivergenceMatch {
  validateRsiDivergenceBaseConfig(config);
  const bars = series.pyth;
  if (bars.length <= config.rsiLength + config.leftBars + config.rightBars) {
    return {
      matched: false,
      evaluation: {
        decision: "neutral",
        reason: "not enough bars for RSI pivots",
      },
    };
  }
  const { signals, lastIndex } = computeCachedSignals({ series, config });
  const signal = selectRecentRsiDivergenceSignal({
    signals,
    lastIndex,
    config,
  });
  if (signal === undefined) {
    return {
      matched: false,
      evaluation: {
        decision: "neutral",
        reason: "no RSI divergence confirmed inside the recency window",
      },
    };
  }

  const decision = isBullish(signal.kind) ? "up" : "down";
  const barsAgo = lastIndex - signal.confirmedIndex;
  return {
    matched: true,
    bars,
    lastIndex,
    signal,
    decision,
    barsAgo,
    evaluation: {
      decision,
      reason:
        barsAgo === 0
          ? `${signal.kind.replaceAll("_", " ")} confirmed on current bar`
          : `${signal.kind.replaceAll("_", " ")} confirmed ${barsAgo} bars ago`,
      metadata: {
        kind: signal.kind,
        pivotIndex: signal.pivotIndex,
        confirmedIndex: signal.confirmedIndex,
        barsAgo,
        rsi: signal.rsi,
        previousRsi: signal.previousRsi,
      },
    },
  };
}

function computeCachedSignals({
  series,
  config,
}: {
  readonly series: AlignedMarketSeries;
  readonly config: RsiDivergenceBaseConfig;
}): CachedRsiDivergenceSignals {
  const key = signalCacheKey({ config });
  const existing = signalCache.get(series)?.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const bars = series.pyth;
  const closes = bars.map((bar) => bar.close);
  const rsi = computeWilderRsiSeries({
    closes,
    period: config.rsiLength,
  });
  const cached = {
    bars,
    lastIndex: bars.length - 1,
    signals: computeRsiDivergenceSignals({
      bars,
      rsi,
      leftBars: config.leftBars,
      rightBars: config.rightBars,
      rangeLower: config.rangeLower,
      rangeUpper: config.rangeUpper,
    }),
  } satisfies CachedRsiDivergenceSignals;
  const seriesCache = signalCache.get(series) ?? new Map();
  seriesCache.set(key, cached);
  signalCache.set(series, seriesCache);
  return cached;
}

function signalCacheKey({
  config,
}: {
  readonly config: RsiDivergenceBaseConfig;
}): string {
  return [
    config.rsiLength,
    config.leftBars,
    config.rightBars,
    config.rangeLower,
    config.rangeUpper,
  ].join(":");
}

export function selectRecentRsiDivergenceSignal({
  signals,
  lastIndex,
  config,
}: {
  readonly signals: readonly RsiDivergenceSignal[];
  readonly lastIndex: number;
  readonly config: RsiDivergenceBaseConfig;
}): RsiDivergenceSignal | undefined {
  return signals
    .filter((candidate) => includeSignal({ kind: candidate.kind, config }))
    .filter((candidate) => candidate.confirmedIndex <= lastIndex)
    .filter((candidate) => {
      const barsAgo = lastIndex - candidate.confirmedIndex;
      return (
        barsAgo >= (config.minSignalAgeBars ?? 0) &&
        barsAgo <= config.maxSignalAgeBars
      );
    })
    .at(-1);
}

function includeSignal({
  kind,
  config,
}: {
  readonly kind: RsiDivergenceKind;
  readonly config: RsiDivergenceBaseConfig;
}): boolean {
  return config.includeHidden || !kind.startsWith("hidden_");
}

function isBullish(kind: RsiDivergenceKind): boolean {
  return kind === "regular_bullish" || kind === "hidden_bullish";
}

function validateRsiDivergenceBaseConfig(
  config: RsiDivergenceBaseConfig,
): void {
  for (const key of ["rsiLength", "leftBars", "rightBars"] as const) {
    const value = config[key];
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`${key} must be a positive integer`);
    }
  }
  for (const key of ["rangeLower", "rangeUpper", "maxSignalAgeBars"] as const) {
    const value = config[key];
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`${key} must be a non-negative integer`);
    }
  }
  if (
    config.minSignalAgeBars !== undefined &&
    (!Number.isInteger(config.minSignalAgeBars) || config.minSignalAgeBars < 0)
  ) {
    throw new Error("minSignalAgeBars must be a non-negative integer");
  }
  if (config.rangeLower > config.rangeUpper) {
    throw new Error("rangeLower must be <= rangeUpper");
  }
  if ((config.minSignalAgeBars ?? 0) > config.maxSignalAgeBars) {
    throw new Error("minSignalAgeBars must be <= maxSignalAgeBars");
  }
}
