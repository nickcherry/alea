import type { CandleTimeframe } from "@alea/types/candles";

/**
 * Maps a alea timeframe to the granularity string accepted by the Coinbase
 * Advanced Trade candles endpoint.
 */
export function coinbaseGranularity({
  timeframe,
}: {
  readonly timeframe: CandleTimeframe;
}): "ONE_MINUTE" | "FIVE_MINUTE" | "FIFTEEN_MINUTE" | "ONE_HOUR" {
  switch (timeframe) {
    case "1m":
      return "ONE_MINUTE";
    case "5m":
      return "FIVE_MINUTE";
    case "15m":
      return "FIFTEEN_MINUTE";
    case "1h":
      return "ONE_HOUR";
    case "4h":
    case "1d":
      // Coinbase Advanced Trade exposes ONE_DAY but no native four-hour
      // granularity. Pyth is the source-of-record for higher timeframes;
      // keep this provider scoped to what we actually use it for.
      throw new Error(
        `Coinbase Advanced Trade granularity not configured for ${timeframe}`,
      );
  }
}
