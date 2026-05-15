# Alea

Filter-committee research toolkit for Polymarket crypto up/down
markets. Alea trains deterministic filters over aligned Pyth and
Coinbase spot candles, selects an asset/regime-aware trade committee,
replays that committee over a holdout window, and runs the same voting
path in dry-run/live trading.

The strategy is directional prediction before the next `5m` or `15m`
candle closes, paired with Polymarket maker orders near 50c. With zero
fees and roughly 1:1 risk/reward, win rate is the edge.

Pyth remains the canonical price and outcome-label source because it
closes closest to Polymarket settlement. Coinbase spot supplies volume
for filters that declare `barSource: "coinbase"`.

The candle store can also ingest `1m` and `1h` bars for research and
source-comparison work. Those are data-only today; trading, committee
selection, and Polymarket settlement workflows still operate on `5m`
and `15m` periods.

## Terminology

Use **training artifacts** or the concrete table names for persisted
research outputs. `training:run` is the CLI that generates them, but
`filter_runs` rows and `filter_engagements` rows are not "backtest
rows" in operator notes, status checks, or docs.

Reserve **backtest** for the holdout replay that simulates trade
committee decisions without order-book or fill modeling.

## How the pieces fit

1. **Training** evaluates filter/config/period/asset candidates and
   writes `filter_runs` + `filter_engagements`.
2. **Regimes** tag historical bars as low/high volatility and
   trending/ranging.
3. **Committee selection** picks the best candidates per
   `(asset, market_regime, period)` and writes `committee_selections`.
4. **Backtest** replays the selected committee over the holdout window
   without Polymarket order-book or fill modeling.
5. **Dry run / live** use the same committee voting logic; only order
   placement differs.
6. **Dashboards** expose proxy calibration, price paths, exploration,
   committee roster, backtest, dry run, and live performance.

Research windows live in
[`src/constants/researchWindows.ts`](./src/constants/researchWindows.ts).
Training ends at `2026-03-31T23:59:59.999Z`; the committee backtest
starts at `2026-04-01T00:00:00.000Z` and runs through yesterday UTC.

## Docs

- [Backtest](./doc/BACKTEST.md) — committee holdout replay.
- [CLI](./doc/CLI.md) — command structure and side effects.
- [Coding Conventions](./doc/CODING_CONVENTIONS.md) — TypeScript and repo style.
- [Committee](./doc/COMMITTEE.md) — selection, ranking, voting.
- [Dashboards](./doc/DASHBOARDS.md) — static dashboard build/deploy.
- [Documentation](./doc/DOCUMENTATION.md) — doc maintenance rules.
- [Dry Run](./doc/DRY_RUN.md) — live decision path without real orders.
- [Filters](./doc/FILTERS.md) — filter contract and registry.
- [How To Work With Nick](./doc/HOW_TO_WORK_WITH_NICK.md) — collaboration preferences.
- [Latency Experiment](./doc/LATENCY_EXPERIMENT.md) — feed-latency research.
- [Live Trading](./doc/LIVE_TRADING.md) — real Polymarket order placement.
- [Market Capture](./doc/MARKET_CAPTURE.md) — long-running market tape capture.
- [Polymarket](./doc/POLYMARKET.md) — Polymarket integration and price paths.
- [Proxy Accuracy](./doc/PROXY.md) — Pyth vs Polymarket settlement agreement.
- [Regimes](./doc/REGIMES.md) — market regime classifier.
- [Reliability Experiment](./doc/RELIABILITY_EXPERIMENT.md) — proxy-feed reliability.
- [Say](./doc/SAY.md) — macOS text-to-speech wrapper for audible alerts.
- [Sweeping](./doc/SWEEPING.md) — committee selection/voting sweep plan.
- [Training](./doc/TRAINING.md) — filter training artifacts.

Research artifacts:

- [Filter Prune 2026-05-11](./doc/results-artifacts/filter-prune-2026-05-11.md)
- [Round 2 Price Filter Prune 2026-05-12](./doc/results-artifacts/round2-price-filter-prune-2026-05-12.md)
- [Filter Redundancy Prune 2026-05-15](./doc/results-artifacts/filter-redundancy-prune-2026-05-15.md)
- [Filter Config Sweep 2026-05-15](./doc/results-artifacts/filter-config-sweep-2026-05-15.md)
- [Filter Weak-Signal Prune 2026-05-15](./doc/results-artifacts/filter-weak-signal-prune-2026-05-15.md)
- [Committee Selection/Voting Sweep 2026-05-15](./doc/results-artifacts/committee-selection-voting-sweep-2026-05-15.md)
- [Trade Decision Default Markets 2026-05-15](./doc/results-artifacts/trade-decision-default-markets-2026-05-15.md)

## Typical workflow

After adding a new filter or refreshing candles:

```sh
bun alea db:migrate              # ensure schema is current
bun alea candles:sync            # refresh candles (default: 5m)
bun alea candles:sync --timeframe 1h --sources pyth --products spot # optional hourly Pyth spot
bun alea training:run            # refresh filter training artifacts
bun alea regimes:backfill        # re-classify every bar (if classifier changed)
bun alea committee:select        # rebuild the asset/regime-scoped voter roster
bun alea backtest:run            # replay latest selected committee
bun alea backtest:sweep-committee # explore committee thresholds without mutating roster
bun alea dashboards:build --deploy
# restart any running `bun alea dry:run` to pick up the new roster
```

Each step is idempotent and skips work that's already current.
