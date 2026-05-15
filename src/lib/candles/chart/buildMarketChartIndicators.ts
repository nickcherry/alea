import { computeEmaSeries } from "@alea/lib/indicators/ema";
import { computeWilderRsiSeries } from "@alea/lib/indicators/rsi";
import {
  computeRsiDivergenceSignals,
  type RsiDivergenceKind,
} from "@alea/lib/indicators/rsiDivergence";
import {
  closesFromBars,
  nullableSeriesToTimeValuePoints,
  type TimeValuePoint,
} from "@alea/lib/indicators/shared/series";
import { computeSmaSeries } from "@alea/lib/indicators/sma";
import type { MarketBar } from "@alea/lib/marketSeries/types";
import type { Candle } from "@alea/types/candles";

export type MarketChartIndicatorLine = {
  readonly id: string;
  readonly label: string;
  readonly color: string;
  readonly lineWidth: number;
  readonly data: readonly TimeValuePoint[];
};

export type MarketChartRsiDivergenceMarker = {
  readonly time: number;
  readonly kind: RsiDivergenceKind;
  readonly text: string;
  readonly color: string;
  readonly position: "aboveBar" | "belowBar";
  readonly shape: "arrowUp" | "arrowDown";
};

export type MarketChartRsiIndicator = {
  readonly label: string;
  readonly color: string;
  readonly overbought: number;
  readonly oversold: number;
  readonly data: readonly TimeValuePoint[];
};

export type MarketChartIndicators = {
  readonly priceLines: readonly MarketChartIndicatorLine[];
  readonly rsi: MarketChartRsiIndicator | null;
  readonly rsiDivergenceMarkers: readonly MarketChartRsiDivergenceMarker[];
};

const defaultSmaLines = [
  { id: "sma20", label: "SMA 20", period: 20, color: "#f2c94c" },
  { id: "sma50", label: "SMA 50", period: 50, color: "#2d9cdb" },
] as const;

const defaultEmaLines = [
  { id: "ema9", label: "EMA 9", period: 9, color: "#bb6bd9" },
  { id: "ema21", label: "EMA 21", period: 21, color: "#f2994a" },
] as const;

const rsiPeriod = 14;
const rsiColor = "#d7dce6";

export function buildDefaultMarketChartIndicators({
  candles,
}: {
  readonly candles: readonly Candle[];
}): MarketChartIndicators {
  const bars = candles.map(candleToMarketBar);
  const closes = closesFromBars({ bars });
  const priceLines: MarketChartIndicatorLine[] = [];

  for (const spec of defaultSmaLines) {
    priceLines.push({
      id: spec.id,
      label: spec.label,
      color: spec.color,
      lineWidth: 2,
      data: nullableSeriesToTimeValuePoints({
        bars,
        values: computeSmaSeries({ closes, period: spec.period }),
      }),
    });
  }

  for (const spec of defaultEmaLines) {
    priceLines.push({
      id: spec.id,
      label: spec.label,
      color: spec.color,
      lineWidth: 1,
      data: nullableSeriesToTimeValuePoints({
        bars,
        values: computeEmaSeries({ closes, period: spec.period }),
      }),
    });
  }

  const rsiValues = computeWilderRsiSeries({ closes, period: rsiPeriod });
  const rsiData = nullableSeriesToTimeValuePoints({
    bars,
    values: rsiValues,
  });

  return {
    priceLines,
    rsi:
      rsiData.length === 0
        ? null
        : {
            label: `RSI ${rsiPeriod}`,
            color: rsiColor,
            overbought: 70,
            oversold: 30,
            data: rsiData,
          },
    rsiDivergenceMarkers: computeRsiDivergenceSignals({
      bars,
      rsi: rsiValues,
      leftBars: 5,
      rightBars: 5,
      minPivotDistance: 5,
      maxPivotDistance: 60,
    }).map((signal) => divergenceMarker({ bars, signal })),
  };
}

function candleToMarketBar(candle: Candle): MarketBar {
  return {
    openTimeMs: candle.timestamp.getTime(),
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
  };
}

function divergenceMarker({
  bars,
  signal,
}: {
  readonly bars: readonly MarketBar[];
  readonly signal: ReturnType<typeof computeRsiDivergenceSignals>[number];
}): MarketChartRsiDivergenceMarker {
  const bar = bars[signal.pivotIndex];
  const bullish =
    signal.kind === "regular_bullish" || signal.kind === "hidden_bullish";
  return {
    time: Math.floor((bar?.openTimeMs ?? 0) / 1000),
    kind: signal.kind,
    text: divergenceLabel(signal.kind),
    color: bullish ? "#20c997" : "#ff6b6b",
    position: bullish ? "belowBar" : "aboveBar",
    shape: bullish ? "arrowUp" : "arrowDown",
  };
}

function divergenceLabel(kind: RsiDivergenceKind): string {
  switch (kind) {
    case "regular_bullish":
      return "Bull div";
    case "hidden_bullish":
      return "H bull";
    case "regular_bearish":
      return "Bear div";
    case "hidden_bearish":
      return "H bear";
  }
}

