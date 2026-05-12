# Alea

Filter-committee research toolkit for Polymarket's crypto up/down
markets. We backtest dozens of small predictive filters against
three years of Pyth/spot candles across every traded asset,
classify each historical bar by market regime, select the
best-performing candidates per regime, and run the resulting
committee against live Pyth ticks in a dry-run loop.

The strategy: pre-window directional prediction (will the next 5m
or 15m candle close green or red?) paired with Polymarket maker
orders at ~50¢. Zero fees, ~1:1 risk-reward, so the win rate IS the
edge.

## Terminology

Use **training artifacts** or the concrete table names for persisted
research outputs. `backtest:run` is the CLI that generates them, but
`filter_runs` rows and `filter_engagements` rows are not "backtest
rows" in operator notes, status checks, or docs.

## How the pieces fit

1. **Filters** are tiny deterministic predictors that emit
   `"up" | "down" | null` from a trailing bar window. See
   [FILTERS.md](./doc/FILTERS.md).
2. **Backtest** evaluates every `(filter, config, period, asset)`
   candidate against the cached candles, persisting per-engagement rows
   to `filter_engagements` and aggregates to `filter_runs`. See
   [BACKTEST.md](./doc/BACKTEST.md).
3. **Market regimes** classify every historical bar into one of
   `{low_vol, high_vol} × {trending, ranging}`. The classifier and
   the `bar_regimes` table let us stratify training stats by
   regime. See [REGIMES.md](./doc/REGIMES.md).
4. **Trading committee** picks the top-N candidates per regime
   using regime-stratified training stats, persisting the voter
   roster to `committee_selections`. At decision time only the
   roster for the current regime gets to vote. See
   [COMMITTEE.md](./doc/COMMITTEE.md).
5. **Dry-run loop** streams live Pyth ticks, classifies the
   current regime, asks the regime's committee to predict the next
   5-minute bar, persists every decision to `dry_run_decisions`,
   simulates the configured post-open Polymarket order, and scores
   the signal once the bar closes. No real orders are placed today;
   live trading will share this exact decision path. See
   [DRY_RUN.md](./doc/DRY_RUN.md).
6. **Dashboards** are static HTML pages built from the same data
   and deployed to a Cloudflare Worker. The exploration page
   surfaces regime-stratified filter performance; the trade committee
   page surfaces the selected voter roster and selection gates; the
   dry-run page surfaces the live committee's hit rate. See
   [DASHBOARDS.md](./doc/DASHBOARDS.md).

## Docs

### Subsystems

- [Filters](./doc/FILTERS.md) — the filter framework + the no-leak
  invariant + the registry.
- [Backtest](./doc/BACKTEST.md) — walker, cache, storage schema,
  quarter buckets.
- [Regimes](./doc/REGIMES.md) — market regime classifier + the
  `bar_regimes` table + backfill.
- [Trading Committee](./doc/COMMITTEE.md) — selection eligibility,
  ranking, regime-scoped voting.
- [Dry Run](./doc/DRY_RUN.md) — live Pyth loop, synthetic bars,
  decision persistence.
- [Dashboards](./doc/DASHBOARDS.md) — design contract + Cloudflare
  Worker deployment.

### Operator workflows

- [CLI](./doc/CLI.md) — command structure, families, side effects.
- [Polymarket Price Paths](./doc/POLYMARKET.md) —
  `bun alea polymarket:price-sample` records live 5m/15m UP price
  paths so we can calibrate how quickly prices move away from 50¢;
  the Price Paths dashboard page visualizes that behavior.
- [Market Capture](./doc/MARKET_CAPTURE.md) — long-running tape
  recorder for Polymarket market data, Pyth spot ticks, and
  Polymarket Chainlink reference events.
- [Latency Experiment](./doc/LATENCY_EXPERIMENT.md) — finding the
  fastest useful leading-indicator feeds.
- [Reliability Experiment](./doc/RELIABILITY_EXPERIMENT.md) —
  checking whether fast exchange-feed proxies are reliable enough
  for Polymarket-side training.
- [Proxy Accuracy](./doc/PROXY.md) — historical agreement between
  Pyth open/close and Polymarket's Chainlink-derived settlement,
  used to calibrate the training threshold.

### Engineering

- [Polymarket Integration](./doc/POLYMARKET.md) — endpoint
  contracts.
- [Coding Conventions](./doc/CODING_CONVENTIONS.md) — repo
  structure, TypeScript style, testing expectations.
- [Documentation](./doc/DOCUMENTATION.md) — how docs are written
  and maintained.
- [How To Work With Nick](./doc/HOW_TO_WORK_WITH_NICK.md) —
  collaboration preferences.

## Typical workflow

After adding a new filter or refreshing candles:

```sh
bun alea db:migrate              # ensure schema is current
bun alea candles:sync            # refresh pyth-spot candles (if needed)
bun alea backtest:run            # re-score every (filter, config, period, asset)
bun alea regimes:backfill        # re-classify every bar (if classifier changed)
bun alea committee:select        # rebuild the regime-scoped voter roster
bun alea dashboards:build --deploy
# restart any running `bun alea dry:run` to pick up the new roster
```

Each step is idempotent and skips work that's already current.
