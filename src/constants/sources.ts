/**
 * Candle data sources currently supported. Stored on persisted candle rows
 * so the same asset/timeframe can be tracked from multiple exchanges.
 *
 * `coindesk` is the CoinDesk Aggregated Liquid Index (CADLI) — a multi-
 * exchange volume-weighted aggregate. `pyth` is the Pyth Network oracle
 * median across ~10+ first-party publishers (Coinbase, Cboe, Wintermute,
 * Virtu, etc), architecturally closest to Chainlink Data Streams' reporter
 * model. Both are aggregate-style proxies for the price Polymarket
 * settles on; see scripts/source_vs_chainlink.ts.
 */
export const candleSourceValues = [
  "coinbase",
  "binance",
  "coindesk",
  "pyth",
] as const;
