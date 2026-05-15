import { candlesPerFetchPage } from "@alea/constants/candles";
import { alignTimeframeWindow } from "@alea/lib/candles/alignTimeframeWindow";
import { fetchCandlesPage } from "@alea/lib/candles/sources/fetchCandlesPage";
import { timeframeMs } from "@alea/lib/candles/timeframeMs";
import type { Asset } from "@alea/types/assets";
import type { Candle, CandleTimeframe } from "@alea/types/candles";
import type { Product } from "@alea/types/products";
import type { CandleSource } from "@alea/types/sources";

type FetchMarketChartCandlesParams = {
  readonly source: CandleSource;
  readonly asset: Asset;
  readonly product: Product;
  readonly timeframe: CandleTimeframe;
  readonly bars?: number;
  readonly start?: Date;
  readonly end?: Date;
};

export type MarketChartCandleWindow = {
  readonly start: Date;
  readonly end: Date;
  readonly mode: "recent" | "range";
};

const maxMarketChartCandles = 2000;

/**
 * Fetches the recent candle window needed for a chart image directly from
 * the configured provider. This deliberately bypasses Postgres so the chart
 * reflects the source's current public market data instead of local sync state.
 */
export async function fetchMarketChartCandles({
  source,
  asset,
  product,
  timeframe,
  bars,
  start,
  end,
}: FetchMarketChartCandlesParams): Promise<readonly Candle[]> {
  const window = marketChartCandleWindow({ timeframe, bars, start, end });
  const barMs = timeframeMs({ timeframe });
  const requestedBars = Math.ceil(
    (window.end.getTime() - window.start.getTime()) / barMs,
  );
  if (requestedBars > maxMarketChartCandles) {
    throw new Error(
      `chart window spans ${requestedBars.toLocaleString()} ${timeframe} bars; maximum is ${maxMarketChartCandles.toLocaleString()}. Narrow the range.`,
    );
  }

  const pageMs = candlesPerFetchPage * barMs;
  const candles: Candle[] = [];

  for (
    let cursorMs = window.start.getTime();
    cursorMs < window.end.getTime();
    cursorMs += pageMs
  ) {
    const pageStart = new Date(cursorMs);
    const pageEnd = new Date(Math.min(cursorMs + pageMs, window.end.getTime()));
    candles.push(
      ...(await fetchCandlesPage({
        source,
        asset,
        product,
        timeframe,
        start: pageStart,
        end: pageEnd,
      })),
    );
  }

  const sorted = filterCandlesForChartWindow({ candles, window });
  return window.mode === "recent" && bars !== undefined
    ? sorted.slice(-bars)
    : sorted;
}

export function filterCandlesForChartWindow({
  candles,
  window,
}: {
  readonly candles: readonly Candle[];
  readonly window: MarketChartCandleWindow;
}): Candle[] {
  const startMs = window.start.getTime();
  const endMs = window.end.getTime();
  return dedupeAndSortCandles({
    candles: candles.filter((candle) => {
      const timestampMs = candle.timestamp.getTime();
      return timestampMs >= startMs && timestampMs < endMs;
    }),
  });
}

export function marketChartCandleWindow({
  timeframe,
  bars,
  start,
  end,
}: {
  readonly timeframe: CandleTimeframe;
  readonly bars?: number;
  readonly start?: Date;
  readonly end?: Date;
}): MarketChartCandleWindow {
  const alignedEnd = alignTimeframeWindow({
    date: end ?? new Date(),
    timeframe,
  });
  if (start !== undefined) {
    const alignedStart = alignTimeframeWindow({ date: start, timeframe });
    if (alignedStart.getTime() >= alignedEnd.getTime()) {
      throw new Error(
        `chart start must be before end after ${timeframe} alignment: ${alignedStart.toISOString()} >= ${alignedEnd.toISOString()}`,
      );
    }
    return {
      start: alignedStart,
      end: alignedEnd,
      mode: "range",
    };
  }

  if (bars === undefined) {
    throw new Error("recent chart mode requires a bar count");
  }

  return {
    start: new Date(alignedEnd.getTime() - bars * timeframeMs({ timeframe })),
    end: alignedEnd,
    mode: "recent",
  };
}

function dedupeAndSortCandles({
  candles,
}: {
  readonly candles: readonly Candle[];
}): Candle[] {
  const byTimestamp = new Map<number, Candle>();
  for (const candle of candles) {
    byTimestamp.set(candle.timestamp.getTime(), candle);
  }
  return [...byTimestamp.values()].sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
  );
}
