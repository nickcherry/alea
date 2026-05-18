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
import { computeWickRejectionSignals } from "@alea/lib/indicators/wickRejection";
import type { MarketBar } from "@alea/lib/marketSeries/types";
import type { Candle } from "@alea/types/candles";

type ComputedWickRejectionSignal = ReturnType<
  typeof computeWickRejectionSignals
>[number];

export type MarketChartIndicatorLine = {
  readonly id: string;
  readonly label: string;
  readonly color: string;
  readonly lineWidth: number;
  readonly data: readonly TimeValuePoint[];
};

export type MarketChartRsiDivergenceMarker = {
  readonly time: number;
  readonly kind: string;
  readonly text: string;
  readonly color: string;
  readonly position: "aboveBar" | "belowBar";
  readonly shape: "arrowUp" | "arrowDown" | "circle" | "square";
};

export type MarketChartPriceActionMarker = {
  readonly time: number;
  readonly kind: string;
  readonly text: string;
  readonly color: string;
  readonly position: "aboveBar" | "belowBar";
  readonly shape: "arrowUp" | "arrowDown" | "circle" | "square";
};

export type MarketChartLegendItem = {
  readonly label: string;
  readonly color: string;
};

export type MarketChartIndicators = {
  readonly priceLines: readonly MarketChartIndicatorLine[];
  readonly rsiDivergenceMarkers: readonly MarketChartRsiDivergenceMarker[];
  readonly priceActionMarkers: readonly MarketChartPriceActionMarker[];
  readonly legendItems?: readonly MarketChartLegendItem[];
};

const defaultSmaLines = [
  { id: "sma20", label: "SMA 20", period: 20, color: "#f2c94c" },
  { id: "sma50", label: "SMA 50", period: 50, color: "#2d9cdb" },
  { id: "sma100", label: "SMA 100", period: 100, color: "#9b51e0" },
  { id: "sma200", label: "SMA 200", period: 200, color: "#27ae60" },
] as const;

const rsiPeriod = 14;
const maxRsiDivergenceMarkers = 28;
const maxPriceActionMarkers = 10;

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

  const rsiValues = computeWilderRsiSeries({ closes, period: rsiPeriod });

  return {
    priceLines,
    rsiDivergenceMarkers: latestItems({
      items: computeRsiDivergenceSignals({
        bars,
        rsi: rsiValues,
        leftBars: 5,
        rightBars: 5,
        rangeLower: 5,
        rangeUpper: 60,
      }).map((signal) => divergenceMarker({ bars, signal })),
      maxItems: maxRsiDivergenceMarkers,
    }),
    priceActionMarkers: latestItems({
      items: recentWickRejectionSignals({
        bars,
        signals: thinNearbyWickRejectionSignals({
          signals: computeWickRejectionSignals({
            bars,
            lookbackBars: 24,
            minWickToRange: 0.6,
          }),
          minIndexDistance: 10,
        }),
      }).map((signal) => wickRejectionMarker({ bars, signal })),
      maxItems: maxPriceActionMarkers,
    }),
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

function wickRejectionMarker({
  bars,
  signal,
}: {
  readonly bars: readonly MarketBar[];
  readonly signal: ComputedWickRejectionSignal;
}): MarketChartPriceActionMarker {
  const bar = bars[signal.index];
  const bullish = signal.kind === "bullish_low_sweep";
  return {
    time: Math.floor((bar?.openTimeMs ?? 0) / 1000),
    kind: signal.kind,
    text: bullish ? "Low sweep" : "High sweep",
    color: bullish ? "#2ee59d" : "#ff7b72",
    position: bullish ? "belowBar" : "aboveBar",
    shape: bullish ? "arrowUp" : "arrowDown",
  };
}

function latestItems<T>({
  items,
  maxItems,
}: {
  readonly items: readonly T[];
  readonly maxItems: number;
}): readonly T[] {
  if (items.length <= maxItems) {
    return items;
  }
  return items.slice(-maxItems);
}

function recentWickRejectionSignals({
  bars,
  signals,
}: {
  readonly bars: readonly MarketBar[];
  readonly signals: readonly ComputedWickRejectionSignal[];
}) {
  const recentBars = Math.max(120, Math.round(bars.length * 0.2));
  const minIndex = Math.max(0, bars.length - recentBars);
  return signals.filter((signal) => signal.index >= minIndex);
}

function thinNearbyWickRejectionSignals({
  signals,
  minIndexDistance,
}: {
  readonly signals: readonly ComputedWickRejectionSignal[];
  readonly minIndexDistance: number;
}) {
  const thinned: ComputedWickRejectionSignal[] = [];
  for (const signal of signals) {
    const previousIndex = thinned.findLastIndex(
      (candidate) =>
        candidate.kind === signal.kind &&
        signal.index - candidate.index < minIndexDistance,
    );
    if (previousIndex === -1) {
      thinned.push(signal);
      continue;
    }
    if (signal.wickToRange > thinned[previousIndex]!.wickToRange) {
      thinned[previousIndex] = signal;
    }
  }
  return thinned;
}
