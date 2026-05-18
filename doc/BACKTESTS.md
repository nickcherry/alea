# Backtests

`bun alea backtest:run` evaluates the candidates registered for each
asset+period market over stored Pyth candles for the traded assets and the `1h`
period. Candidate sets can still differ by asset. Results persist to
`candidate_backtest_quarter_results`, one row per candidate, asset, timeframe,
and quarter.

The default backtest window starts at January 1, 2025. Operators can still
override the window with `--start` / `--end`.

Each row has a `cache_hash` derived from the candidate identity, canonical
config, filter version, asset, period, Pyth source, quarter window, decision
schema version, backtest engine version, lead time, hydration depth, and the
Pyth candle inputs used for that quarter. When `backtest:run` sees an existing
row with the same hash, it treats that candidate/asset/period/quarter as cached
and does not regenerate it. If any of those inputs change, the hash changes and
that quarter is regenerated.

Backtests intentionally mirror dry-run/live timing. For each target 1h candle,
the simulator evaluates filters 10 minutes before that same candle closes.
Closed timeframe bars stop before the target candle, and the final active
candle is synthesized only from stored Pyth `1m` candles whose minute close is
available by the HH:50 decision timestamp. That prevents future candle leakage.

The quarterly row stores compact decision tuples in JSON:

```ts
[target_candle_open_ms, "up" | "down", 0 | 1];
```

Neutral evaluations are counted but not written into the decision tuple array.
The backtest dashboard at `/backtest/` aggregates those rows by candidate and
quarter, supports the active `1h` period, adds an asset toggle so each asset
has its own table, filters to the currently active registry for each
asset+period market, and sorts candidates by overall win rate within that
table.
