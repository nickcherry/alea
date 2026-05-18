See [README.md](./README.md).

⚠️ **Before doing anything that touches filters, backtests, dry-run, or
live trading, read [doc/DECISION_TIMING.md](./doc/DECISION_TIMING.md).**
Getting the target-candle and synthetic-bar timing wrong invalidates every
backtest number. The single most common mistake is assuming the partial
synthetic bar in the filter input is the candle being predicted. It is
not — it is the candle *before* the target, in progress at decision time.
The target candle has not opened yet when the decision fires.
