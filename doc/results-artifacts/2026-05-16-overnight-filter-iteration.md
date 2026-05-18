# Filter Research Reset

This note intentionally preserves only the useful conclusion from the retired
search work: Alea is now focused on `1h` Polymarket crypto up/down markets.
Older short-window filter sweeps and artifacts were removed from the active
repo surface so new research does not accidentally reuse retired assumptions.

Current active baseline:

- Asset set: BTC, ETH, SOL, DOGE.
- Market period: `1h`.
- Decision timing: 10 minutes before the current hourly market closes.
- Candidate surface: a small, curated registry rather than committee voting.
- Backtest source: Pyth spot candles, with a synthetic current-hour candle
  built only from data available by decision time.

Future research should be written as formal scripts or first-class filters, and
new artifacts should describe hourly-market behavior only.
