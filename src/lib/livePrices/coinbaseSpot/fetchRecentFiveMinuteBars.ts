import { fetchCoinbaseAdvancedTradeCandles } from "@alea/lib/candles/sources/coinbase/fetchCoinbaseAdvancedTradeCandles";
import { coinbaseProductId } from "@alea/lib/candles/sources/coinbase/coinbaseProductId";
import type { ClosedFiveMinuteBar } from "@alea/lib/livePrices/types";
import type { Asset } from "@alea/types/assets";

const FIVE_MINUTES_MS = 5 * 60 * 1000;

/**
 * Live-trading boot helper for the coinbase-spot price source. Pulls
 * the most recent CLOSED 5m candles off the Coinbase Advanced Trade
 * REST endpoint so the regime trackers have a hot seed at startup —
 * mirrors `binancePerp/fetchRecentFiveMinuteBars.ts`, just pointed at
 * coinbase-spot product ids and the `fetchCoinbaseAdvancedTradeCandles`
 * pager.
 *
 * Returns at most `count` bars in chronological order. Filters out the
 * currently-open bar.
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
  const candles = await fetchCoinbaseAdvancedTradeCandles({
    productId: coinbaseProductId({ asset }),
    product: "spot",
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
      // Skip the in-progress window.
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
  // Coinbase returns oldest-first; ensure ascending and trim to count.
  out.sort((a, b) => a.openTimeMs - b.openTimeMs);
  return out.slice(-count);
}

/**
 * Fetches one exact 5m bar by open timestamp. Used by live settlement
 * — same role `binancePerp.fetchExactFiveMinuteBar` plays. Coinbase's
 * candles endpoint returns rows whose `timestamp` is the open time, so
 * we ask for a tight `[openTimeMs, openTimeMs + 5min)` window and
 * verify the returned row matches.
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
  const candles = await fetchCoinbaseAdvancedTradeCandles({
    productId: coinbaseProductId({ asset }),
    product: "spot",
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
