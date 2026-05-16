# Alea

Alea is a Polymarket crypto up/down trading system built around
versioned filter candidates. It keeps recent Pyth candles available,
evaluates deterministic filters against the same candle state in dry-run,
live, and backtest modes, and places or simulates Polymarket maker orders
when those candidates produce an actionable up/down majority.

The strategy is directional prediction before the next `5m` or `15m`
candle closes, paired with Polymarket maker orders near 50c. With zero
fees and roughly 1:1 risk/reward, win rate is the edge.

Pyth remains the canonical price and outcome source because it closes
closest to Polymarket settlement. Coinbase spot remains available for
volume-bearing chart context and source-comparison work.

The candle store can ingest `1m`, `5m`, `15m`, and `1h` bars. Live and
dry-run trading operate on `5m` and `15m` Polymarket markets.

## How the pieces fit

1. **Candles** sync and store Pyth/Coinbase OHLCV history.
2. **Filters** define typed, versioned decision logic plus exact config and
   source requirements.
3. **Candidates** are filter+config pairs; dry run, live trading, and
   backtests all evaluate the same candidate registry.
4. **Dry run / live** share the filter-decision path; dry run simulates
   orders, live trading places real Polymarket maker orders.
5. **Dashboards** expose proxy calibration, Polymarket price paths,
   candidate backtests, dry-run performance, and live trading PnL.

## Docs

- [CLI](./doc/CLI.md) — command structure and side effects.
- [Coding Conventions](./doc/CODING_CONVENTIONS.md) — TypeScript and repo style.
- [Dashboards](./doc/DASHBOARDS.md) — static dashboard build/deploy.
- [Documentation](./doc/DOCUMENTATION.md) — doc maintenance rules.
- [Filters](./doc/FILTERS.md) — filter and candidate interface.
- [Backtests](./doc/BACKTESTS.md) — historical candidate evaluation.
- [Dry Run](./doc/DRY_RUN.md) — live decision path without real orders.
- [Latency Experiment](./doc/LATENCY_EXPERIMENT.md) — feed-latency research.
- [Live Trading](./doc/LIVE_TRADING.md) — real Polymarket order placement.
- [Market Capture](./doc/MARKET_CAPTURE.md) — long-running market tape capture.
- [Polymarket](./doc/POLYMARKET.md) — Polymarket integration and price paths.
- [Proxy Accuracy](./doc/PROXY.md) — Pyth vs Polymarket settlement agreement.
- [Reliability Experiment](./doc/RELIABILITY_EXPERIMENT.md) — proxy-feed reliability.
- [Say](./doc/SAY.md) — macOS text-to-speech wrapper for audible alerts.

## Typical workflow

```sh
bun alea db:migrate
bun alea candles:sync
bun alea candles:chart --asset btc --timeframe 5m
bun alea backtest:run
bun alea dry:run
bun alea dashboards:build --deploy
# restart any running `bun alea trading:run` after changing runtime config
```

Each command is non-interactive and should explain its side effects in
`bun alea help <command>`.
