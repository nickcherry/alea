import {
  pythSpotCandleSource,
  type TradingFilter,
} from "@alea/lib/filters/types";
import { computeWilderRsiSeries } from "@alea/lib/indicators/rsi";
import {
  computeRsiDivergenceSignals,
  type RsiDivergenceKind,
} from "@alea/lib/indicators/rsiDivergence";

export type RsiDivergenceConfig = {
  readonly rsiLength: number;
  readonly includeHidden: boolean;
  readonly leftBars: number;
  readonly rightBars: number;
  readonly minPivotDistance: number;
  readonly maxPivotDistance: number;
  readonly signalLookbackBars: number;
};

export const rsiDivergenceFilter: TradingFilter<RsiDivergenceConfig> = {
  id: "rsi_divergence",
  name: "RSI Divergence",
  version: 1,
  description:
    "Looks for confirmed RSI divergences between recent price pivots and Wilder RSI on Pyth candles. Regular bullish or bearish divergences vote with the reversal implied by the divergence, and the config can optionally include hidden divergences that favor trend continuation.",
  sources: [pythSpotCandleSource],
  evaluate({ series, config }) {
    validateConfig(config);
    const bars = series.pyth;
    if (bars.length <= config.rsiLength + config.leftBars + config.rightBars) {
      return { decision: "neutral", reason: "not enough bars for RSI pivots" };
    }
    const closes = bars.map((bar) => bar.close);
    const rsi = computeWilderRsiSeries({
      closes,
      period: config.rsiLength,
    });
    const lastIndex = bars.length - 1;
    const signal = computeRsiDivergenceSignals({
      bars,
      rsi,
      leftBars: config.leftBars,
      rightBars: config.rightBars,
      minPivotDistance: config.minPivotDistance,
      maxPivotDistance: config.maxPivotDistance,
    })
      .filter((candidate) => includeSignal({ kind: candidate.kind, config }))
      .filter((candidate) => candidate.confirmedIndex <= lastIndex)
      .filter(
        (candidate) =>
          lastIndex - candidate.confirmedIndex <= config.signalLookbackBars,
      )
      .at(-1);
    if (signal === undefined) {
      return {
        decision: "neutral",
        reason: "no recent confirmed RSI divergence",
      };
    }
    const decision = isBullish(signal.kind) ? "up" : "down";
    return {
      decision,
      reason: `${signal.kind.replaceAll("_", " ")} confirmed ${lastIndex - signal.confirmedIndex} bars ago`,
      metadata: {
        kind: signal.kind,
        pivotIndex: signal.pivotIndex,
        confirmedIndex: signal.confirmedIndex,
        rsi: signal.rsi,
        previousRsi: signal.previousRsi,
      },
    };
  },
};

function includeSignal({
  kind,
  config,
}: {
  readonly kind: RsiDivergenceKind;
  readonly config: RsiDivergenceConfig;
}): boolean {
  return config.includeHidden || !kind.startsWith("hidden_");
}

function isBullish(kind: RsiDivergenceKind): boolean {
  return kind === "regular_bullish" || kind === "hidden_bullish";
}

function validateConfig(config: RsiDivergenceConfig): void {
  for (const key of [
    "rsiLength",
    "leftBars",
    "rightBars",
    "minPivotDistance",
    "maxPivotDistance",
    "signalLookbackBars",
  ] as const) {
    const value = config[key];
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`${key} must be a positive integer`);
    }
  }
  if (config.minPivotDistance > config.maxPivotDistance) {
    throw new Error("minPivotDistance must be <= maxPivotDistance");
  }
}
