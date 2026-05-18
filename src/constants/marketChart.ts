import type { CandleTimeframe } from "@alea/types/candles";

export const MARKET_CHART_FALLBACK_RECENT_BARS = 288;

type MarketChartRecentWindow = {
  readonly days: number;
  readonly bars: number;
};

export const MARKET_CHART_RECENT_WINDOWS: Readonly<
  Partial<Record<CandleTimeframe, MarketChartRecentWindow>>
> = {};

export const MAX_MARKET_CHART_RECENT_BARS = Math.max(
  MARKET_CHART_FALLBACK_RECENT_BARS,
  ...Object.values(MARKET_CHART_RECENT_WINDOWS).map((window) => window.bars),
);

export function marketChartRecentBarsForTimeframe({
  timeframe,
}: {
  readonly timeframe: CandleTimeframe;
}): number {
  return (
    MARKET_CHART_RECENT_WINDOWS[timeframe]?.bars ??
    MARKET_CHART_FALLBACK_RECENT_BARS
  );
}

export function marketChartRecentWindowLabel({
  timeframe,
}: {
  readonly timeframe: CandleTimeframe;
}): string {
  const window = MARKET_CHART_RECENT_WINDOWS[timeframe];
  if (window === undefined) {
    return `${MARKET_CHART_FALLBACK_RECENT_BARS.toLocaleString()} bars`;
  }
  return `${window.days.toLocaleString()} days / ${window.bars.toLocaleString()} bars`;
}
