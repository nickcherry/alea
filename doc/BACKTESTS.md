# Backtests

`bun alea backtest:run` evaluates every registered candidate over stored Pyth
candles for the traded assets and the `5m` / `15m` periods. Results persist to
`candidate_backtest_quarter_results`, one row per candidate, asset, timeframe,
and quarter.

Backtests intentionally mirror dry-run/live timing. For each target candle,
the simulator evaluates filters before the target opens using
`tradeDecisionLeadTimeMs({ period })`. Closed timeframe bars stop at the last
fully closed candle, and the final active candle is synthesized only from
stored Pyth `1m` candles whose minute close is available by the decision
timestamp. That prevents future candle leakage.

The quarterly row stores compact decision tuples in JSON:

```ts
[target_candle_open_ms, "up" | "down", 0 | 1];
```

Neutral evaluations are counted but not written into the decision tuple array.
The backtest dashboard at `/backtest/` aggregates those rows by candidate and
quarter, supports the same `5m` / `15m` toggle as the trading surfaces, and
sorts candidates by overall win rate.
