import { fetchPythCandles } from "@alea/lib/candles/sources/pyth/fetchPythCandles";
import type { ClosedFiveMinuteBar } from "@alea/lib/livePrices/types";
import type { Asset } from "@alea/types/assets";

const FIVE_MINUTES_MS = 5 * 60 * 1000;

/**
 * Live-trading boot helper for the pyth-spot price source. Pulls the
 * most recent CLOSED 5m candles off the Pyth Benchmarks TradingView
 * shim so the regime trackers have a hot seed at startup. Same role
 * `coinbaseSpot/fetchRecentFiveMinuteBars.ts` plays, just routed at
 * the Pyth oracle aggregate instead of a single venue.
 *
 * Returns at most `count` bars in chronological order. Filters out
 * the currently-open bar.
 */
export async function fetchRecentFiveMinuteBars({
  asset,
  count,
  signal: _signal,
}: {
  readonly asset: Asset;
  readonly count: number;
  readonly signal?: AbortSignal;
}): Promise<readonly ClosedFiveMinuteBar[]> {
  if (count <= 0) {
    return [];
  }
  // Over-fetch by one window to leave headroom in case the most-recent
  // returned bar is the in-progress one (we filter it below).
  const nowMs = Date.now();
  const minutes = (count + 1) * 5;
  const start = new Date(nowMs - minutes * 60_000);
  const end = new Date(nowMs);
  const candles = await fetchPythCandles({
    asset,
    timeframe: "5m",
    start,
    end,
  });
  const out: ClosedFiveMinuteBar[] = [];
  for (const candle of candles) {
    const openTimeMs = candle.timestamp.getTime();
    const closeTimeMs = openTimeMs + FIVE_MINUTES_MS;
    if (closeTimeMs > nowMs) {
      continue;
    }
    out.push({
      asset,
      openTimeMs,
      closeTimeMs,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    });
  }
  out.sort((a, b) => a.openTimeMs - b.openTimeMs);
  return out.slice(-count);
}

/**
 * Fetches one exact 5m bar by open timestamp. Used by live settlement
 * and the source's bar-close poller — same role
 * `coinbaseSpot.fetchExactFiveMinuteBar` plays. Pyth's shim returns
 * rows whose timestamp is the open time (we drop off-grid rows in
 * `fetchPythCandles`), so a tight `[openTimeMs, openTimeMs + 5min)`
 * window will return at most one row.
 */
export async function fetchExactFiveMinuteBar({
  asset,
  openTimeMs,
  signal: _signal,
}: {
  readonly asset: Asset;
  readonly openTimeMs: number;
  readonly signal?: AbortSignal;
}): Promise<ClosedFiveMinuteBar | null> {
  const start = new Date(openTimeMs);
  const end = new Date(openTimeMs + FIVE_MINUTES_MS);
  const candles = await fetchPythCandles({
    asset,
    timeframe: "5m",
    start,
    end,
  });
  const candle = candles.find((c) => c.timestamp.getTime() === openTimeMs);
  if (candle === undefined) {
    return null;
  }
  const closeTimeMs = openTimeMs + FIVE_MINUTES_MS;
  if (closeTimeMs > Date.now()) {
    return null;
  }
  return {
    asset,
    openTimeMs,
    closeTimeMs,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  };
}
