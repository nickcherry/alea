import {
  pythSpotCandleSource,
  type TradingFilter,
} from "@alea/lib/filters/types";
import { computeWickRejectionSignals } from "@alea/lib/indicators/wickRejection";

export type WickRejectionConfig = {
  readonly lookbackBars: number;
  readonly minWickToRange: number;
  readonly signalLookbackBars: number;
};

export const wickRejectionFilter: TradingFilter<WickRejectionConfig> = {
  id: "wick_rejection",
  name: "Wick Rejection",
  version: 1,
  description:
    "Searches recent Pyth candles for a sweep of a local high or low that closes back inside the prior range. A low sweep with a strong lower wick votes up, while a high sweep with a strong upper wick votes down.",
  sources: [pythSpotCandleSource],
  evaluate({ series, config }) {
    validateConfig(config);
    const bars = series.pyth;
    if (bars.length <= config.lookbackBars) {
      return {
        decision: "neutral",
        reason: "not enough bars for wick-rejection lookback",
      };
    }
    const lastIndex = bars.length - 1;
    const signal = computeWickRejectionSignals({
      bars,
      lookbackBars: config.lookbackBars,
      minWickToRange: config.minWickToRange,
    })
      .filter(
        (candidate) => lastIndex - candidate.index <= config.signalLookbackBars,
      )
      .at(-1);
    if (signal === undefined) {
      return { decision: "neutral", reason: "no recent wick rejection" };
    }
    const bullish = signal.kind === "bullish_low_sweep";
    return {
      decision: bullish ? "up" : "down",
      reason: `${signal.kind.replaceAll("_", " ")} ${lastIndex - signal.index} bars ago`,
      metadata: {
        kind: signal.kind,
        index: signal.index,
        priorExtreme: signal.priorExtreme,
        wickToRange: signal.wickToRange,
      },
    };
  },
};

function validateConfig(config: WickRejectionConfig): void {
  if (!Number.isInteger(config.lookbackBars) || config.lookbackBars <= 0) {
    throw new Error("lookbackBars must be a positive integer");
  }
  if (
    !Number.isFinite(config.minWickToRange) ||
    config.minWickToRange <= 0 ||
    config.minWickToRange >= 1
  ) {
    throw new Error("minWickToRange must be greater than 0 and less than 1");
  }
  if (
    !Number.isInteger(config.signalLookbackBars) ||
    config.signalLookbackBars <= 0
  ) {
    throw new Error("signalLookbackBars must be a positive integer");
  }
}
