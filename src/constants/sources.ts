/**
 * Candle data sources currently supported. Stored on persisted candle rows
 * so the same asset/timeframe can be tracked from multiple exchanges.
 *
 * `coindesk` is the CoinDesk Aggregated Liquid Index (CADLI) — a multi-
 * exchange volume-weighted aggregate, used as a closer proxy for the
 * Chainlink Data Streams price Polymarket settles on than any single
 * exchange. See scripts/source_vs_chainlink.ts.
 */
export const candleSourceValues = [
  "coinbase",
  "binance",
  "coindesk",
] as const;
