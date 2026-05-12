/**
 * Stable candle timeframes the system understands.
 * Stored as the `timeframe` column on persisted candle rows.
 */
export const candleTimeframeValues = ["1m", "5m", "15m", "1h"] as const;

/**
 * Default number of candles requested per page when paginating through
 * exchange historical APIs. 288 five-minute candles == 1 calendar day.
 * Source-specific fetchers can opt into a larger window when the provider
 * supports it.
 */
export const candlesPerFetchPage = 288;

/**
 * Default lookback window when none is specified.
 */
export const defaultCandleLookbackDays = 730;
