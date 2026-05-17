import {
  type FilterDecision,
  pythSpotCandleSource,
  type TradingFilter,
} from "@alea/lib/filters/types";
import type { MarketBar } from "@alea/lib/marketSeries/types";

export type SidePriorTrendCap = {
  readonly bars: number;
  readonly maxBps: number;
};

export type RangeBreakoutFadeConfig = {
  readonly lookbackBars: number;
  readonly minBreakBps: number;
  readonly closeLocationThreshold: number;
  readonly atrBars: number;
  readonly minActiveRangeAtrFraction: number;
  readonly priorTrendBars: number;
  readonly maxPriorTrendBps: number;
  readonly maxBreakBps?: number;
  readonly maxActiveMoveBps?: number;
  readonly maxActiveRangeAtrFraction?: number;
  readonly sidePriorTrendCaps?: readonly SidePriorTrendCap[];
  readonly compressionBars?: number;
  readonly compressionDistanceBps?: number;
  readonly maxCompressionCount?: number;
};

type BreakoutSide = "up" | "down";

export const rangeBreakoutFadeFilter: TradingFilter<RangeBreakoutFadeConfig> = {
  id: "range_breakout_fade",
  name: "Range Breakout Fade",
  version: 1,
  description:
    "Looks for the in-progress candle, built only from minutes available at decision time, closing just beyond a recent high or low. If that pre-open break is large enough, but not part of an already overextended trend, the filter fades the break and bets the next candle snaps back inside the range. Optional caps can avoid oversized breaks, same-direction trend pressure, and repeated compression against the level.",
  sources: [pythSpotCandleSource],
  evaluate({ series, config }) {
    validateConfig(config);
    const bars = series.pyth;
    const active = bars.at(-1);
    const history = bars.slice(0, -1);
    if (active === undefined || history.length < minHistoryBars(config)) {
      return { decision: "neutral", reason: "not enough candle history" };
    }

    const atr = averageRangeBps(history.slice(-config.atrBars));
    const activeRangeBps = moveBps(active.low, active.high);
    if (atr <= 0 || activeRangeBps < atr * config.minActiveRangeAtrFraction) {
      return { decision: "neutral", reason: "active range too small" };
    }
    if (
      config.maxActiveRangeAtrFraction !== undefined &&
      activeRangeBps > atr * config.maxActiveRangeAtrFraction
    ) {
      return { decision: "neutral", reason: "active range too large" };
    }

    const priorTrend = trendBps({
      history,
      bars: config.priorTrendBars,
    });
    if (Math.abs(priorTrend) > config.maxPriorTrendBps) {
      return { decision: "neutral", reason: "prior trend too large" };
    }

    const recent = history.slice(-config.lookbackBars);
    const high = Math.max(...recent.map((bar) => bar.high));
    const low = Math.min(...recent.map((bar) => bar.low));
    const closeLocation = closeLocationInRange(active);

    const upBreakBps = active.close > high ? moveBps(high, active.close) : 0;
    if (
      upBreakBps >= config.minBreakBps &&
      closeLocation >= config.closeLocationThreshold
    ) {
      return evaluateBreakout({
        side: "up",
        decision: "down",
        breakBps: upBreakBps,
        level: high,
        active,
        history,
        config,
        priorTrend,
        atr,
      });
    }

    const downBreakBps = active.close < low ? moveBps(active.close, low) : 0;
    if (
      downBreakBps >= config.minBreakBps &&
      closeLocation <= 1 - config.closeLocationThreshold
    ) {
      return evaluateBreakout({
        side: "down",
        decision: "up",
        breakBps: downBreakBps,
        level: low,
        active,
        history,
        config,
        priorTrend,
        atr,
      });
    }

    return { decision: "neutral", reason: "no range break" };
  },
};

function evaluateBreakout({
  side,
  decision,
  breakBps,
  level,
  active,
  history,
  config,
  priorTrend,
  atr,
}: {
  readonly side: BreakoutSide;
  readonly decision: FilterDecision;
  readonly breakBps: number;
  readonly level: number;
  readonly active: MarketBar;
  readonly history: readonly MarketBar[];
  readonly config: RangeBreakoutFadeConfig;
  readonly priorTrend: number;
  readonly atr: number;
}) {
  if (config.maxBreakBps !== undefined && breakBps > config.maxBreakBps) {
    return { decision: "neutral" as const, reason: "break too large" };
  }
  const activeMove = Math.abs(moveBps(active.open, active.close));
  if (
    config.maxActiveMoveBps !== undefined &&
    activeMove > config.maxActiveMoveBps
  ) {
    return { decision: "neutral" as const, reason: "active move too large" };
  }
  const sideSign = side === "up" ? 1 : -1;
  for (const cap of config.sidePriorTrendCaps ?? []) {
    const sideTrend = sideSign * trendBps({ history, bars: cap.bars });
    if (sideTrend > cap.maxBps) {
      return {
        decision: "neutral" as const,
        reason: "same-side prior trend too large",
      };
    }
  }
  if (
    config.compressionBars !== undefined &&
    config.compressionDistanceBps !== undefined &&
    config.maxCompressionCount !== undefined
  ) {
    const compressionCount = countCompressionCloses({
      bars: history.slice(-config.compressionBars),
      side,
      level,
      maxDistanceBps: config.compressionDistanceBps,
    });
    if (compressionCount > config.maxCompressionCount) {
      return {
        decision: "neutral" as const,
        reason: "too much compression against range edge",
      };
    }
  }
  return {
    decision,
    reason:
      side === "up"
        ? "fading upside range break"
        : "fading downside range break",
    metadata: {
      side,
      breakBps,
      level,
      priorTrendBps: priorTrend,
      activeRangeAtr: moveBps(active.low, active.high) / atr,
    },
  };
}

function validateConfig(config: RangeBreakoutFadeConfig): void {
  assertPositiveInteger(config.lookbackBars, "lookbackBars");
  assertPositiveInteger(config.atrBars, "atrBars");
  assertPositiveInteger(config.priorTrendBars, "priorTrendBars");
  if (config.minBreakBps < 0) {
    throw new Error("minBreakBps must be non-negative");
  }
  if (
    config.closeLocationThreshold <= 0.5 ||
    config.closeLocationThreshold >= 1
  ) {
    throw new Error(
      "closeLocationThreshold must be greater than 0.5 and below 1",
    );
  }
  if (config.minActiveRangeAtrFraction < 0) {
    throw new Error("minActiveRangeAtrFraction must be non-negative");
  }
  if (config.maxPriorTrendBps < 0) {
    throw new Error("maxPriorTrendBps must be non-negative");
  }
  if (config.compressionBars !== undefined) {
    assertPositiveInteger(config.compressionBars, "compressionBars");
  }
  if (
    config.compressionDistanceBps !== undefined &&
    config.compressionDistanceBps < 0
  ) {
    throw new Error("compressionDistanceBps must be non-negative");
  }
  if (
    config.maxCompressionCount !== undefined &&
    (!Number.isInteger(config.maxCompressionCount) ||
      config.maxCompressionCount < 0)
  ) {
    throw new Error("maxCompressionCount must be a non-negative integer");
  }
  for (const cap of config.sidePriorTrendCaps ?? []) {
    assertPositiveInteger(cap.bars, "sidePriorTrendCaps.bars");
  }
}

function minHistoryBars(config: RangeBreakoutFadeConfig): number {
  return Math.max(
    config.lookbackBars,
    config.atrBars,
    config.priorTrendBars,
    ...(config.sidePriorTrendCaps ?? []).map((cap) => cap.bars),
    config.compressionBars ?? 0,
  );
}

function closeLocationInRange(bar: MarketBar): number {
  const range = bar.high - bar.low;
  if (range <= 0) {
    return 0.5;
  }
  return (bar.close - bar.low) / range;
}

function trendBps({
  history,
  bars,
}: {
  readonly history: readonly MarketBar[];
  readonly bars: number;
}): number {
  const start = history.at(-bars);
  const end = history.at(-1);
  if (start === undefined || end === undefined) {
    return 0;
  }
  return moveBps(start.open, end.close);
}

function averageRangeBps(bars: readonly MarketBar[]): number {
  if (bars.length === 0) {
    return 0;
  }
  return (
    bars.reduce((sum, bar) => sum + moveBps(bar.low, bar.high), 0) / bars.length
  );
}

function countCompressionCloses({
  bars,
  side,
  level,
  maxDistanceBps,
}: {
  readonly bars: readonly MarketBar[];
  readonly side: BreakoutSide;
  readonly level: number;
  readonly maxDistanceBps: number;
}): number {
  return bars.filter((bar) => {
    const distance =
      side === "up" ? moveBps(bar.close, level) : moveBps(level, bar.close);
    return distance >= 0 && distance <= maxDistanceBps;
  }).length;
}

function moveBps(start: number, end: number): number {
  if (start === 0) {
    return 0;
  }
  return ((end - start) / start) * 10_000;
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}
