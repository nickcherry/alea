import type { CandleTimeframe } from "@alea/types/candles";

/**
 * Maps a alea timeframe to the `interval` query parameter accepted by the
 * Binance public klines endpoint. Binance supports `15m` and `1h` natively too;
 * keeping the union narrow to what we actually fetch keeps the call
 * sites typed-safe.
 */
export function binanceInterval({
  timeframe,
}: {
  readonly timeframe: CandleTimeframe;
}): "1m" | "5m" | "15m" | "1h" {
  return timeframe;
}
