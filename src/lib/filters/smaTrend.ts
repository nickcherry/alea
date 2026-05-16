import {
  pythSpotCandleSource,
  type TradingFilter,
} from "@alea/lib/filters/types";
import { computeSmaSeries } from "@alea/lib/indicators/sma";

export type SmaTrendConfig = {
  readonly fastLength: number;
  readonly slowLength: number;
  readonly minSpreadBps: number;
  readonly requireCloseConfirmation: boolean;
};

export const smaTrendFilter: TradingFilter<SmaTrendConfig> = {
  id: "sma_trend",
  name: "SMA Trend",
  version: 1,
  description:
    "Compares a fast simple moving average with a slower one on the current Pyth candle path. It votes up when the fast average is sufficiently above the slow average and, when configured, price is also above the fast average; it votes down on the mirrored bearish setup.",
  sources: [pythSpotCandleSource],
  evaluate({ series, config }) {
    validateConfig(config);
    const bars = series.pyth;
    const closes = bars.map((bar) => bar.close);
    const latest = bars.at(-1);
    if (latest === undefined || closes.length < config.slowLength) {
      return {
        decision: "neutral",
        reason: "not enough bars for slow SMA",
      };
    }
    const fast = computeSmaSeries({
      closes,
      period: config.fastLength,
    }).at(-1);
    const slow = computeSmaSeries({
      closes,
      period: config.slowLength,
    }).at(-1);
    if (
      fast === null ||
      fast === undefined ||
      slow === null ||
      slow === undefined
    ) {
      return { decision: "neutral", reason: "SMA values unavailable" };
    }
    const spreadBps = ((fast - slow) / latest.close) * 10_000;
    const bullishCloseOk =
      !config.requireCloseConfirmation || latest.close >= fast;
    const bearishCloseOk =
      !config.requireCloseConfirmation || latest.close <= fast;
    if (spreadBps >= config.minSpreadBps && bullishCloseOk) {
      return {
        decision: "up",
        reason: `fast SMA is ${spreadBps.toFixed(1)}bps above slow SMA`,
        metadata: { fast, slow, spreadBps },
      };
    }
    if (spreadBps <= -config.minSpreadBps && bearishCloseOk) {
      return {
        decision: "down",
        reason: `fast SMA is ${Math.abs(spreadBps).toFixed(1)}bps below slow SMA`,
        metadata: { fast, slow, spreadBps },
      };
    }
    return {
      decision: "neutral",
      reason: `SMA spread ${spreadBps.toFixed(1)}bps is below threshold`,
      metadata: { fast, slow, spreadBps },
    };
  },
};

function validateConfig(config: SmaTrendConfig): void {
  if (!Number.isInteger(config.fastLength) || config.fastLength <= 0) {
    throw new Error("fastLength must be a positive integer");
  }
  if (!Number.isInteger(config.slowLength) || config.slowLength <= 0) {
    throw new Error("slowLength must be a positive integer");
  }
  if (config.fastLength >= config.slowLength) {
    throw new Error("fastLength must be less than slowLength");
  }
  if (!Number.isFinite(config.minSpreadBps) || config.minSpreadBps < 0) {
    throw new Error("minSpreadBps must be a non-negative number");
  }
}
