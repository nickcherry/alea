# Alea Codebase Handoff for ChatGPT

Last reviewed: 2026-05-06.

This file is a standalone technical handoff for a reviewer who cannot see the
repository. It summarizes the documentation, source code, data model, runtime
flows, and known source-of-truth details in the current working tree.

**Recent architectural changes** (early May 2026, all reflected below):

- **Filters → regimes** (commit `4e82390`, refined in `6d37a1d`): the live
  probability table is now generated from the regime registry, not the filter
  registry. Filters remain as legacy benchmarking only. The decision evaluator
  uses a multi-algo greedy strategy across the persisted leading-regime tables.
- **Regime registry trim** (commit `6d37a1d`): from 10 algos down to 3
  survivors — `vol_only_3`, `vol_quartiles_4`, `trend_x_vol_6`. Auto-promoted
  leading regimes per asset are listed under "Probability Table Generation".
- **Market capture pipeline** (commit `6b43173`): long-running `data:capture`
  records every Polymarket / Binance / Coinbase / Chainlink WS event into the
  `market_event` Postgres table for offline replay/research.
- **Replay infrastructure** (commit `ec8d4b8`): `trading:replay` walks
  captured windows through the live decision + maker-order + fill-simulation
  pipeline; `trading:replay-report` renders the dashboard. See "Replay
  Infrastructure" section below.
- **Capture writer wedge fix + cleanup** (commit `0666e9e`): rollover
  callbacks run on a separate sequential chain; settlement retries capped at
  30 (~60s); `formatUsd`/`formatPercent` extracted to `src/lib/trading/format.ts`.

The project is named Alea. It is probabilistic tooling for Polymarket
5-minute crypto up/down markets. The app studies live exchange feeds, trains
empirical settlement-side probability surfaces from historical candles, and
runs a gated trader that only acts when its modeled edge clears the current
market quote.

## High-Level Product Shape

Alea is not a general trading platform. It is a specific research and
execution system for Polymarket's crypto markets where, every five minutes,
an asset has a binary question of the form "will this asset be up or down
relative to the price at the start of the five-minute window?" The current
asset whitelist is:

- `btc`
- `eth`
- `sol`
- `xrp`
- `doge`

The app has four large operating modes:

1. Candle ingestion: fetches and stores historical OHLCV candles in local
   Postgres for supported exchange/source/product/timeframe combinations.
2. Research dashboards: latency, reliability, training distributions, and
   trading performance dashboards, all written as paired HTML and JSON files
   under `tmp/`.
3. Offline training: reads historical Binance perpetual candles and produces
   survival surfaces and filter overlays. A production subset of this training
   becomes the committed live probability table.
4. Trading: dry-run and live runners use an injected live price source
   (Binance perpetual futures by default), Polymarket as the venue, a generated
   probability table as the model, and Telegram as the live operator
   notification channel.

The live trader currently trades Polymarket through a vendor abstraction. It
only places maker-only limit BUY orders on YES outcome tokens. It does not
place market orders. It uses the current Polymarket bid as the limit price and
requires a positive modeled edge above that bid before attempting to place.

## Repository, Stack, and Tooling

The repository root is `/Users/nickcherry/src/alea`.

Important root files:

- `README.md`: top-level doc index and short product summary.
- `AGENTS.md`: says to see `README.md`.
- `package.json`: Bun app, private package, CLI binary named `alea`.
- `tsconfig.json`: strict TypeScript, `moduleResolution: bundler`,
  `noUncheckedIndexedAccess`, `noImplicitOverride`, and `@alea/*` path alias.
- `eslint.config.js`: type-checked ESLint, no `any`, no unused imports,
  simple import sort, absolute internal imports required, environment access
  restricted to `src/constants/env.ts` except in tests.
- `.prettierrc`: Prettier config.
- `bun.lock`: dependency lockfile.

Runtime and language:

- Bun is the runtime, package manager, and CLI entrypoint.
- TypeScript is the app language.
- Zod is used for CLI input validation, environment-adjacent schemas, and
  external API boundary parsing.
- PostgreSQL is the only database.
- Kysely is the typed SQL/migration layer.
- `pg` and `pg-cursor` are the Postgres drivers/cursor utilities.
- Polymarket integration uses `@polymarket/clob-client-v2` and `ethers`.
- CLI color output uses `picocolors`.

Package scripts:

- `bun alea`: wrapper around `bun run src/bin/index.ts`.
- `bun run typecheck`: runs `bun x --bun tsc --noEmit`.
- `bun run test`: finds all `*.test.ts` files under `src` and runs `bun test`.
- `bun run lint`: ESLint with cache.
- `bun run lint:fix`: ESLint fix with cache.
- `bun run format`: Prettier write.

Approximate codebase size from the current tree:

- 251 TypeScript files under `src`.
- 59 test files.
- About 26,860 non-test source lines.

Major source directories:

- `src/bin`: CLI command definitions.
- `src/constants`: assets, candle constants, environment, exchanges, products,
  Polymarket endpoints, trading constants, training series.
- `src/types`: broad domain schemas and types.
- `src/lib/candles`: historical candle fetching, gap filling, persistence.
- `src/lib/cli`: command definition, parser, help renderer, usage errors.
- `src/lib/db`: Kysely setup and migrations.
- `src/lib/exchangePrices`: latency experiment stream capture and charting.
- `src/lib/livePrices`: live Binance perp feed, five-minute window helpers,
  per-asset rolling 5m bar buffer (`RegimeTrackers`), and the
  `RegimeClassifierInput` builder shared with training.
- `src/lib/polymarket`: CLOB auth, auth check, user websocket probe.
- `src/lib/reliability`: directional agreement experiment.
- `src/lib/telegram`: Telegram Bot API sender.
- `src/lib/trading`: probability tables, decision evaluator, dry run, live
  trader, Polymarket vendor adapter, state/PnL/Telegram helpers.
- `src/lib/training`: candle analysis, survival snapshots, filters, scoring,
  caching, dashboard rendering.
- `src/lib/ui`: shared HTML dashboard design system.

## Documentation Map

The README points to these docs:

- `doc/CLI.md`: operator CLI contract, command families, help behavior, output
  conventions, error handling, and how to add commands.
- `doc/LATENCY_EXPERIMENT.md`: why exchange feeds are compared against
  Polymarket/Chainlink, what the latency chart shows, and current findings.
- `doc/RELIABILITY_EXPERIMENT.md`: directional agreement test between fast
  exchange proxies and Polymarket Chainlink settlement feed.
- `doc/TRAINING_DOMAIN.md`: offline analysis, survival surface, filters
  (legacy benchmarking), scoring methodology, sweet spots, cache, output files.
- `doc/REGIMES.md`: regime registry, the partitions that drive the live
  probability table, and the auto-promotion mechanics.
- `doc/TRADING.md`: live trading model, architecture, vendor abstraction,
  five-minute window lifecycle, API touchpoints, failure modes, Telegram
  messages, and trading commands.
- `doc/DRY_TRADING.md`: dry-run fill simulation, JSONL session shape, and
  report interpretation.
- `doc/MARKET_CAPTURE.md`: long-running tape recorder for offline replay.
- `doc/REPLAY.md`: offline replay of the live decision pipeline against the
  captured `market_event` table.
- `doc/DASHBOARDS.md`: design contract for temp HTML dashboards under `tmp/`.
- `doc/POLYMARKET.md`: endpoint constants, official docs links, and current
  Polymarket assumptions.
- `doc/CODING_CONVENTIONS.md`: repo structure, TS style, testing, dependencies,
  module boundaries.
- `doc/DOCUMENTATION.md`: what to document and how.
- `doc/HOW_TO_WORK_WITH_NICK.md`: collaboration preferences and trading-work
  caution.
- `doc/research/*`: dated research notes on filter scoring, sample floors,
  sweet spots, and archived filters.

The docs are generally detailed and operational. A few current
source-of-truth caveats are listed near the end under "Review-Relevant Source
Facts".

## Command Surface

The app exposes one main CLI entrypoint:

```sh
bun alea
```

Registered commands in `src/bin/index.ts`:

- `db:migrate`
- `candles:sync`
- `candles:fill-gaps`
- `data:capture` — long-running market-data tape recorder (Polymarket + Binance + Coinbase + Chainlink WS) into `market_event` Postgres
- `data:ingest-pending` — one-shot ingester for orphaned JSONL session files
- `latency:capture`
- `latency:chart`
- `reliability:capture`
- `reliability:chart`
- `training:distributions`
- `telegram:test`
- `polymarket:auth-check`
- `trading:gen-probability-table`
- `trading:dry-run`
- `trading:dry-run-report`
- `trading:live`
- `trading:hydrate-lifetime-pnl`
- `trading:performance`
- `trading:replay` — offline replay against captured `market_event` data
- `trading:replay-report` — render an HTML dashboard from a replay session
- built-in `help`

CLI framework details:

- Each command is a `defineCommand({ ... })` value.
- Options are `defineValueOption` or `defineFlagOption`.
- Positionals use `definePositional`.
- Zod schemas define validation, coercion, defaults, and descriptions.
- `createCli` adds built-in help, validates duplicate command names/options,
  parses args, converts Zod validation failures into `CliUsageError`, and
  prints stack traces for unexpected errors.
- Parser supports long and short flags, `--key=value`, `--` positional
  terminator, duplicate detection, missing value detection, unknown option
  detection, and required positional validation.
- Command files are intentionally thin glue. Domain work is done in
  `src/lib/<domain>`.

## Constants and Shared Types

Assets:

- `src/constants/assets.ts` defines `assetValues = ["btc", "eth", "sol",
"xrp", "doge"]`.
- `src/types/assets.ts` defines the matching Zod enum and `Asset` type.

Candle dimensions:

- Timeframes: `1m` and `5m`.
- Sources: `coinbase` and `binance`.
- Products: `spot` and `perp`.
- `src/types/candleSeries.ts` combines source/product/timeframe into a
  validated `CandleSeries`.

Training series:

- `src/constants/training.ts` defines the canonical training candle series as
  `source: "binance"`, `product: "perp"`, `timeframe: "5m"`.
- Survival training also loads matching `1m` bars for the same source/product.

Trading constants in `src/constants/trading.ts`:

- `MIN_BUCKET_SAMPLES = 200` — minimum sample count for a probability bucket to be considered tradable
- `MIN_ACTIONABLE_DISTANCE_BP = 2` — minimum bp distance from line at which we engage at all
- `MIN_EDGE = 0.05` — minimum (`ourProbability − marketImpliedProbability`) to take a trade
- `MIN_MODEL_PROBABILITY = 0.55` — minimum model probability for the chosen side; must clear in addition to `MIN_EDGE`
- `MIN_QUEUE_AHEAD_SHARES = 20` — minimum queue depth at the chosen-side limit price for placement to proceed
- `REGIME_TRACKER_BOOTSTRAP_BARS = 70` — closed 5m bars pulled at boot to seed the per-asset rolling bar buffer
- `STAKE_USD = 20` — fixed USD stake per trade
- `MAKER_FEE_RATE = 0` — current Polymarket maker-fee rate (zero today on these markets)
- `ORDER_CANCEL_MARGIN_MS = 10_000` — cancel residual orders 10s before window close
- `WINDOW_SUMMARY_DELAY_MS = 8_000` — Telegram summary fires 8s after window close
- `WINNING_YES_PAYOUT_USD = 1` — Polymarket winning YES token payout
- `LIVE_TRADING_REGIME_ALGOS` — the live regime algo set (currently `vol_only_3`, `vol_quartiles_4`, `trend_x_vol_6`); aliased from the registry
- `LEADING_REGIME_MIN_LEAD_PP = 1.0` — minimum hold-rate lead vs baseline for a regime to be persisted in the live table
- `REGIME_CELL_MIN_SAMPLES = 400` — minimum sample count per (regime, remaining, distance) cell pre-aggregation

Environment constants in `src/constants/env.ts`:

- `DATABASE_URL`, defaulting to `postgres://localhost:5432/alea`.
- `DATABASE_POOL_MAX`.
- `TELEGRAM_BOT_TOKEN`.
- `TELEGRAM_CHAT_ID`.
- `POLYMARKET_PRIVATE_KEY`.
- `POLYMARKET_FUNDER_ADDRESS`.

Polymarket constants in `src/constants/polymarket.ts`:

- Polygon chain id.
- L1 auth API key nonce 0. V2 orders themselves do not carry the old V1
  order nonce.
- Signature type for Polymarket Gnosis Safe usage.
- CLOB REST URL.
- Gamma API URL.
- CLOB market websocket URL.
- CLOB user websocket URL.
- RTDS websocket URL.

## Database and Candle Storage

There is one database table: `candles`.

Migration file: `src/lib/db/migrations/202605021900_create_candles.ts`.

Columns:

- `source`: text, not null.
- `asset`: text, not null.
- `product`: text, not null.
- `timeframe`: text, not null.
- `timestamp`: timestamptz, not null, start of bar in UTC.
- `open`, `high`, `low`, `close`, `volume`: double precision, not null.

Primary key:

- `(source, asset, product, timeframe, timestamp)`.

Constraints:

- `timeframe in ('1m', '5m')`
- `source in ('coinbase', 'binance')`
- `product in ('spot', 'perp')`

Indexes:

- `(asset, product, timeframe, timestamp)` for cross-source lookup by asset and
  product.
- `(timeframe, timestamp)` for range scans across a timeframe.

DB setup:

- `createDatabase` creates a Kysely instance backed by `pg.Pool`.
- `destroyDatabase` closes the Kysely instance.
- `createMigrator` loads TypeScript migrations.
- `runMigrationsToLatest` runs pending migrations and throws with detailed
  errors if any migration fails.

## Candle Fetching and Maintenance

The candle subsystem fetches, stores, and gap-fills historical OHLCV bars.

Main flows:

- `candles:sync` fetches candle pages over a requested range and upserts them.
- `candles:fill-gaps` finds missing bars inside existing table ranges and
  fetches replacements.
- `db:migrate` applies DB migrations.

Important implementation details:

- `syncCandles` pages the requested range in chunks of 288 candles per fetch
  page.
- `upsertCandles` batches 1000 rows at a time and updates OHLCV on primary key
  conflict.
- `findCandleGaps` uses Postgres `generate_series` between min and max
  timestamp to identify missing runs.
- `fillCandleGaps` fetches gap chunks and only upserts returned candles that
  fall inside the expected gap.
- `fetchCandlesPage` dispatches by `(source, product)` and retries HTTP 429 up
  to five times, using `retry-after` if present or one second otherwise.

Source-specific candle fetching:

- Binance spot uses `data-api.binance.vision/api/v3/klines`.
- Binance perpetuals use Binance Vision zip archives. The implementation
  routes between monthly and daily archives, uses `funzip`, and keeps an
  in-memory cache capped at 32 archive payloads. It intentionally does not
  use current-day archives.
- Coinbase spot/perp uses Coinbase Advanced Trade candles endpoints.
- Coinbase spot product ids are shaped like `BTC-USD`.
- Coinbase perp product ids are shaped like `BTC-PERP-INTX`.

The candle table is the input source for offline training and probability
generation. Live trading does not write candles.

## Live Price Feed and Window Helpers

Live price domain files live under `src/lib/livePrices`.

Core types:

- `LivePriceTick`: asset, bid, ask, mid, optional exchange time in ms, local
  received time in ms.
- `ClosedFiveMinuteBar`: asset, open time ms, close time ms, OHLC.

Five-minute helpers:

- `currentWindowStartMs({ nowMs })`: UTC floor to the active five-minute
  boundary.
- `nextWindowStartMs({ nowMs })`: next UTC five-minute boundary.
- `remainingInWindowMs`.
- `flooredRemainingMinutes`, which maps the current location inside the window
  to the training snapshot buckets:
  - between +0:00 and +1:00: `null`
  - between +1:00 and +2:00: 4
  - between +2:00 and +3:00: 3
  - between +3:00 and +4:00: 2
  - between +4:00 and +5:00: 1

Regime trackers (replaces the old per-feature EMA/ATR trackers):

- `createRegimeTrackers` keeps a per-asset rolling buffer of recently
  closed 5m bars (capped at 70).
- `append(bar)` admits strictly-increasing `openTimeMs` only;
  duplicates and out-of-order bars are dropped.
- `bars()` returns the buffer in chronological order; the live
  decision evaluator passes this to `computeRegimeClassifierInput`,
  which folds the buffer through the same `build5mLookback` index the
  training-side snapshot pipeline runs over historical candles.
- Every input the lookback can compute (EMA-20/50, ATR-3/14/50,
  RSI-14, prev-bar direction) is automatically available at decision
  time. Adding a regime algo that consumes a new feature requires zero
  live-side wiring.

Binance live stream:

- `streamBinancePerpQuotes` (in `src/lib/exchangePrices/sources/binance/`)
  opens one combined Binance Futures websocket for all requested assets.
- It subscribes to `<symbol>@bookTicker` and `<symbol>@kline_5m`.
- It emits BBO ticks continuously.
- It emits closed five-minute bars only when the kline frame has `k.x` true.
- Reconnect delays are `[1000, 2000, 5000, 10000, 30000]` ms via the shared
  `wsClient/createReconnectingWebSocket` helper.
- A stale-frame watchdog reconnects if no message lands for thirty seconds.
- The trader consumes it through a thin adapter at
  `src/lib/livePrices/binancePerp/source.ts` that maps `QuoteTick` →
  `LivePriceTick` for the existing tracker code; the same streamer also
  feeds `latency:capture`, `reliability:capture`, and `data:capture`.

Recent bar fetchers:

- `fetchRecentFiveMinuteBars` calls `fapi.binance.com/fapi/v1/klines` for
  recent closed 5m bars, overfetches by one, and drops the open bar.
- `fetchExactFiveMinuteBar` fetches a precise settlement bar by open time.
- The docs note that Binance Futures `fapi` is geo-blocked from the United
  States and that production is expected to run from Spain or a non-US network.

## Latency Experiment

Purpose:

- Determine which live exchange feed gives the earliest useful read on where
  the Polymarket/Chainlink settlement feed will land.
- The experiment focuses on relative moves from each venue's own start price,
  not absolute price equality across venues.

Command:

- `bun alea latency:capture`
- `bun alea latency:capture --exhaustive`
- `bun alea latency:chart [path]`

Default source roster:

- `binance-spot`
- `binance-perp`
- `coinbase-spot`
- `coinbase-perp`
- `polymarket-chainlink`

Exhaustive mode adds:

- Bybit spot/perp.
- OKX spot/swap.
- Bitstamp.
- Gemini.

Implementation details:

- `captureAllQuoteStreams` starts all requested quote streams concurrently,
  accumulates BTC quote ticks for the requested duration, then closes all
  streams and returns counts/errors/ticks.
- Timestamps for lead/lag are local receipt times.
- Polymarket Chainlink source uses RTDS topic `crypto_prices_chainlink` and
  filters BTC/USD in the latency experiment.
- Coinbase uses Advanced Trade websocket `level2` channel and maintains BBO
  state, emitting only BBO changes.
- Binance book ticker emits on BBO price or quantity changes.
- Bybit, OKX, Bitstamp, and Gemini each have source-specific parsers.

Dashboard:

- `renderPriceChartHtml` creates a standalone uPlot page.
- It has a spot panel and a perp panel.
- It uses a shared 100 ms grid, with mid prices interpolated at the grid.
- Polymarket/Chainlink is emphasized.
- Exhaustive mode overlays spot and perp consensus lines using static volume
  weights.

Static consensus weights:

- Spot: Binance 0.60, Coinbase 0.18, Bybit 0.07, OKX 0.07, Bitstamp 0.05,
  Gemini 0.03.
- Perp: Binance 0.63, Bybit 0.20, OKX 0.15, Coinbase 0.02.

Current documented findings:

- Binance perp leads everything in observed low/normal volatility captures.
- Binance spot tracks Binance perp tightly.
- Coinbase spot/perp lag Binance by roughly 0.5 to 2 seconds and tick less
  densely.
- Polymarket/Chainlink lags spot exchanges by roughly 5 to 10 seconds during
  real moves.

## Reliability Experiment

Purpose:

- Check whether fast exchange feeds are directionally reliable proxies for
  Polymarket's Chainlink-settled five-minute markets.
- The key question is not "do the prices match?" but "when each source anchors
  to its own start price at the same window boundary, does it finish on the
  same up/down side as Polymarket Chainlink?"

Commands:

- `bun alea reliability:capture --duration 3600`
- `bun alea reliability:capture --indefinite`
- `bun alea reliability:capture --fresh`
- `bun alea reliability:capture --resume <path>`
- `bun alea reliability:chart [path]`

Feeds:

- Baseline: `polymarket-chainlink`.
- Comparable sources: `coinbase-spot`, `coinbase-perp`, `binance-spot`,
  `binance-perp`.
- Assets default to the repo whitelist.

Window method:

1. Wait for a full UTC-aligned five-minute window.
2. For each asset/source, capture the first tick at or after window start.
3. Capture the first tick at or after window end within the grace period.
4. Resolve source outcome as up if `end >= start`, otherwise down.
5. Compare non-Polymarket sources against the Polymarket baseline.

Tie convention:

- Ties resolve to up. This matches the training and trading code.

Runner behavior:

- Writes JSON incrementally.
- By default, resumes the newest compatible capture unless `--fresh` is used.
- Stores compact window summaries, not raw ticks, so long runs do not grow with
  tick volume.
- Tracks per-source source cell statuses such as complete, missing start,
  missing end, stale start, stale end, and no market.
- Agreement rates count only windows where both baseline and source completed
  with usable ticks.
- Near-zero disagreements are separately counted when the Polymarket baseline
  moved no more than the configured near-zero bp threshold, default 1 bp.

Dashboard:

- `renderReliabilityHtml` creates a standalone dark dashboard.
- It shows summary metrics, source agreement, asset breakdown, feed health, and
  a window ledger with OK/DIFF statuses.

## Training Domain

Purpose:

- Offline analysis of historical candles.
- No orders.
- No candle table mutation.
- Reads local Postgres and writes artifacts to `tmp/`.
- Optional deploy flag publishes the latest training dashboard to a Cloudflare
  Worker through Wrangler.

Command:

```sh
bun alea training:distributions
```

Useful flags:

- `--assets btc,eth`
- `--no-cache`
- `--no-open`
- `--deploy`

Training analyses:

1. Candle body and wick distributions.
2. Point-of-no-return survival surface.
3. Binary filter overlays with calibration metrics.

### Candle Size Distributions

For each five-minute candle:

- Body percent: `abs(close - open) / open * 100`.
- Wick percent: `(high - low) / open * 100`.

Percentiles:

- Computed with standard linear interpolation equivalent to numpy's `linear`
  method.
- P0 is min, P50 is median, P100 is max.
- Histogram bin width is 0.01 percent, which is one basis point.
- Visible range goes to the max of body P99 and wick P99, with overflow.

The current HTML focuses on survival/filter charts. The JSON sidecar also
contains body/wick distributions and per-year breakdowns.

### Survival Snapshots

Source file: `src/lib/training/computeSurvivalSnapshots.ts`.

Current pipeline version in code:

- `SNAPSHOT_PIPELINE_VERSION = 16`.

Input:

- Gap-free one-minute candles grouped into UTC-aligned five-minute windows.
- Exactly five one-minute bars are required per window.
- Optional five-minute candles provide lookback context.

Window conventions:

- Line price is the open of the first one-minute candle in the five-minute
  window.
- Final price is the close of the fifth one-minute candle.
- Final side is up if `finalPrice >= line`, else down.
- Ties resolve up.

Snapshots emitted per valid window:

- At candle index 0: remaining 4.
- At candle index 1: remaining 3.
- At candle index 2: remaining 2.
- At candle index 3: remaining 1.

Snapshot fields:

- `snapshotPrice`: close of the current one-minute candle.
- `currentSide`: up if `snapshotPrice >= line`, else down.
- `distanceBp`: `floor(abs(snapshotPrice - line) / line * 10000 + 1e-9)`.
- `survived`: whether `currentSide === finalSide`.
- `remaining`: 4, 3, 2, or 1.
- `windowStartMs`.
- Context object described below.

Lookback context:

- The five-minute context index only uses bars strictly before the current
  five-minute window.
- That means live and training both intend to evaluate indicators through the
  most recently closed prior five-minute bar, not the current open bar.

Context fields computed by the survival pipeline include:

- Last 3, 5, and 10 five-minute directions.
- SMA20 and SMA50.
- EMA20 and EMA50.
- EMA50 slope over 10 bars.
- RSI14, using Wilder-style smoothing.
- ROC20 and ROC5.
- ATR14 and ATR50, using Wilder ATR.
- Donchian50 high/low and age.
- Previous and previous-previous five-minute bars.
- Standard deviation over 20 bars.
- Stochastic14.
- Previous volume and average 50-bar volume.
- Recent/prior five-bar ranges.
- Current one-minute microbar direction.
- Previous micro distance in bp.

### Baseline Survival Distribution

`computeSurvivalDistribution` folds snapshots into:

- Overall baseline by `(remaining, distanceBp)`.
- By-year baseline breakdowns.
- Distinct five-minute window counts.

The survival question is:

Given a snapshot at a certain remaining-minute bucket and distance from the
line, what is the probability the side currently leading will still be the
winner at the five-minute close?

### Filter Framework (legacy benchmarking)

**Filters are now legacy benchmarking only** as of commit `4e82390`.
The live probability table is generated from the **regime registry**,
not the filter registry. Filters remain in the dashboard for
diagnostic comparison; no filter result feeds the live trader.

Filter type:

- `SurvivalFilter`.
- Fields: id, display name, description, true label, false label, version,
  and `classify(snapshot, context)`.
- Classifier returns `true`, `false`, or `"skip"`.

Currently registered filters in code (all dashboard-only):

1. `distance_from_line_atr_3` — distance ≥ 0.5 × ATR-3
2. `distance_from_line_atr_4` — distance ≥ 0.5 × ATR-4
3. `distance_from_line_atr` — distance ≥ 0.5 × ATR-14 (the historical comparator)
4. `ema_50_5m_alignment` — current side aligned with the EMA-50 regime

The research archive documents 26 retired filters and why they were
removed from the active registry. The live signal now comes from the
three regime algos: `vol_only_3`, `vol_quartiles_4`, `trend_x_vol_6`
(see "Regime Framework" below).

### Regime Framework (live)

Regime algo type:

- `RegimeAlgo`.
- Fields: id, displayName, description, version, regimes (the partition
  labels), params, and `classify(input: RegimeClassifierInput) → label
  | null`.
- `null` indicates warmup (required features haven't seeded).

Currently registered regime algos in code (all live):

1. `vol_only_3` — `low_vol` (≤ 0.7), `mid_vol` (0.7-1.3), `high_vol` (≥ 1.3) on ATR-14 ÷ ATR-50.
2. `vol_quartiles_4` — quartile-style cuts on ATR-14 ÷ ATR-50 at 0.6 / 1.0 / 1.5.
3. `trend_x_vol_6` — `{no_trend, with_trend, against_trend} × {low_vol, high_vol}` using `|EMA20-EMA50|/ATR14` (cut at 0.5) and ATR-14 ÷ ATR-50 (cut at 1.0).

Adding a new algo: drop a file under `src/lib/training/regimeAlgos/`,
append to `regimeAlgos/registry.ts`, regenerate the probability table.
Algos auto-promote to live trading at next gen-time if any of their
regimes' `avgLeadPp` clears `LEADING_REGIME_MIN_LEAD_PP` (1.0pp).

The seven algos pruned in commit `6d37a1d` (`vol_only_2`,
`vol_only_2_tight`, `vol_only_2_atr3`, `trend_strength_3`,
`trend_only_3`, `prev_bar_carry_2`, `rsi_3`) were either redundant
with the survivors or didn't clear the live-promotion floor.

### Filter Scoring

Main implementation:

- `src/lib/training/survivalFilters/applySurvivalFilters.ts`
- `src/lib/training/survivalFilters/computeSweetSpot.ts`

Current floors:

- `SUMMARY_MIN_SAMPLES = 2000`, imported from `SWEET_SPOT_MIN_SAMPLES`.
- Renderer mirror: `SURVIVAL_MIN_SAMPLES = 2000`.
- Trading table materialization floor is separate: `MIN_BUCKET_SAMPLES = 200`
  by default for `trading:gen-probability-table`.

Headline metric:

- `calibrationScore`.
- It is average information gain in nats per population snapshot versus the
  global no-filter baseline.
- Skipped snapshots remain in the denominator and contribute zero numerator.
- The intent is to grade coverage and precision on the same axis.

Per-cell metrics:

- `score`: sample-weighted signed area between a half's rate curve and the
  filter-conditioned baseline, in pp-bp units.
- `meanDeltaPp`: sample-weighted mean probability-point delta.
- `sharpe`: mean delta divided by stdev of bucket deltas.
- `logLossImprovementNats`: information gain versus the conditioned baseline.
- `coverageBp`: count of distance buckets clearing the sample floor for both
  halves.

Why two baselines:

- The headline uses the global baseline because it asks whether using the
  filter improves prediction quality versus no filter at all.
- Per-cell scoring uses the filter-conditioned baseline because it asks which
  half of a filter split is better inside the kept population.

This change was made because global-baseline signed-area scoring biased
against high-skip filters. The research note
`doc/research/2026-05-04-filter-scoring-overhaul.md` documents the issue.

### Sweet Spot Detection

Implementation:

- `src/lib/training/survivalFilters/computeSweetSpot.ts`.

Current code constants:

- `SWEET_SPOT_INFO_GAIN_THRESHOLD = 0.80`.
- `SWEET_SPOT_MIN_SAMPLES = 2000`.

Algorithm:

1. For each counted `(remaining, half, distance)` cell, compute positive
   information gain versus the global baseline.
2. Aggregate that positive gain by distance in basis points.
3. Find the narrowest contiguous `[startBp, endBp]` whose summed positive gain
   captures `SWEET_SPOT_INFO_GAIN_THRESHOLD` of total positive gain.
4. Compute restricted calibration as `gainInRange / snapshotsInRange`.
5. Compute coverage as `snapshotsInRange / snapshotsTotal`.
6. Return null if there is no positive gain.

Sweet spots are used as a discipline rule: the production probability table
drops buckets outside each asset's sweet-spot bp range, and live lookup returns
null there.

### Training Cache

Cache root:

- `tmp/cache/training-distributions`.

Subdirectories:

- `size`
- `survival`
- `filters`

Cache keys:

- First 16 chars of SHA-256 over a canonical sorted manifest.

Manifest includes:

- Series identity.
- Asset.
- Latest one-minute and five-minute candle timestamps.
- Algorithm/pipeline/filter versions.

Behavior:

- Cache read failures are treated as misses.
- Cached numeric results are overlaid with live filter metadata so text-only
  display changes do not force recomputation.

### Training Dashboard

Renderer:

- `src/lib/training/renderTrainingDistributionsHtml.ts`, about 2397 lines.

Characteristics:

- Standalone HTML with uPlot.
- Uses the shared Alea design system.
- Asset tabs.
- Baseline survival chart.
- Filter overlay sections sorted by calibration score.
- Top-ranked filter section expanded.
- Main chart shows baseline/true/false rates.
- Delta chart shows true/false deltas versus baseline with density fills.
- Compact lift chart shows true rate minus global rate and sweet-spot overlay.
- Calibration is rendered as percentage of `ln(2)` baseline log loss.

Output files:

- `tmp/training-distributions_<timestamp>.html`
- `tmp/training-distributions_<timestamp>.json`

Deploy:

- `--deploy` copies HTML to `tmp/web/index.html`, writes a deploy-source file,
  and runs `bunx wrangler deploy` to a static assets worker.

## Probability Table Generation

Command:

```sh
bun alea trading:gen-probability-table
```

Source file:

- `src/bin/trading/genProbabilityTable.ts`.

Output:

- Overwrites `src/lib/trading/probabilityTable/probabilityTable.generated.ts`.
- Writes a JSON sidecar under `tmp/probability-table_<timestamp>.json`.

Inputs:

- Local Postgres candles.
- Canonical training series: Binance perpetuals.
- One-minute bars for snapshots.
- Five-minute bars for lookback context.

Generation algorithm (regime-conditional, since commit `4e82390`):

1. Load one-minute and five-minute candles per asset.
2. Run `computeSurvivalSnapshots`.
3. For each algo in `LIVE_TRADING_REGIME_ALGOS`, classify every snapshot
   into one of the algo's regimes (or skip on warmup).
4. Per (algo, regime) pair, accumulate a raw surface keyed by
   `(remaining, distanceBp)` with `(survived, total)` per cell.
5. Compute the unconditional baseline surface across all snapshots.
6. For each (algo, regime), compute `avgLeadPp` — the sample-weighted
   mean of `(regimeRate − baselineRate)` in pp across cells that meet
   `MIN_ACTIONABLE_DISTANCE_BP` AND `REGIME_CELL_MIN_SAMPLES` (400).
7. Persist the regime as a `LeadingRegimeTable` only if `avgLeadPp ≥
   LEADING_REGIME_MIN_LEAD_PP` (1.0pp). Lagging or tied regimes are
   excluded entirely; the runtime decision evaluator skips an algo's
   contribution when the snapshot's regime under that algo isn't in the
   persisted table.
8. Sweet-spot the surviving surfaces (same `computeSweetSpot` helper the
   filter framework used).
9. Drop buckets below `--min-samples` (default 200).
10. Write a TypeScript module, not a JSON import.

Runtime lookup:

- `lookupAllProbabilities` walks the asset's `leadingTables` and emits
  one entry per (algo, regime) pair where the snapshot's classification
  matches AND the bucket at `(remaining, distanceBp)` exists.
- Multiple matching entries are normal — the decision evaluator uses
  the multi-algo greedy strategy described in the next section.
- It does not interpolate. It does not fall back to neighboring
  buckets. Missing bucket means no signal from that (algo, regime).

Current committed generated table (regenerated 2026-05-06 after the
regime trim):

- `minBucketSamples = 200`.
- Training range: `2023-05-04` … `2026-05-02`. All five assets have
  `windowCount = 315,116`.

Auto-promoted leading regimes per asset (from the latest regen):

| Asset | Leading regimes (algo / regime / avg-lead-pp)                                                                                            |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| BTC   | `vol_only_3/low_vol +6.5pp`, `vol_quartiles_4/vol_q2 +2.0pp`, `trend_x_vol_6/no_trend_low_vol +2.5pp`, `trend_x_vol_6/against_trend_low_vol +2.6pp` |
| ETH   | `vol_only_3/low_vol +7.3pp`, `vol_quartiles_4/vol_q2 +1.7pp`, `trend_x_vol_6/no_trend_low_vol +2.2pp`, `trend_x_vol_6/against_trend_low_vol +2.2pp` |
| SOL   | `vol_quartiles_4/vol_q2 +1.6pp`, `trend_x_vol_6/no_trend_low_vol +1.9pp`, `trend_x_vol_6/against_trend_low_vol +2.4pp` (no `vol_only_3` leader) |
| XRP   | `vol_only_3/low_vol +3.7pp`, `vol_quartiles_4/vol_q2 +1.5pp`, `trend_x_vol_6/no_trend_low_vol +1.8pp`, `trend_x_vol_6/against_trend_low_vol +1.8pp` |
| DOGE  | `vol_only_3/low_vol +3.6pp`, `vol_quartiles_4/vol_q2 +1.5pp`, `trend_x_vol_6/no_trend_low_vol +1.9pp`, `trend_x_vol_6/against_trend_low_vol +2.2pp` |

## Decision Evaluator

Source:

- `src/lib/trading/decision/evaluateDecision.ts`

Inputs:

- Asset.
- Window start time.
- Current `nowMs`.
- Line price.
- Current price.
- `regimeInput` — pre-computed `RegimeClassifierInput` containing every
  feature any registered algo might read (`leadingSide`, EMA-20/50,
  ATR-3/14/50, RSI-14, prev-bar direction). Algos return `null` from
  `classify` when their required features haven't seeded yet.
- Current best bid for up YES.
- Current best bid for down YES.
- Up/down token ids.
- Probability table.
- Minimum edge.

Multi-algo greedy decision flow implemented in code:

1. Compute floored remaining minutes. If null, skip `out-of-window`.
2. Compute absolute distance and `distanceBp`.
3. If distance is below `MIN_ACTIONABLE_DISTANCE_BP`, skip
   `too-close-to-line`.
4. Compute current side, with ties up.
5. Classify the snapshot under every algo in `LIVE_TRADING_REGIME_ALGOS`,
   building `regimesByAlgoId: Map<algoId, regime>`. Algos that returned
   `null` (warmup) are absent from the map.
6. If no algo classified anything, skip `warmup`.
7. Iterate every persisted leading-regime table for the asset; emit a
   lookup entry for every (algo, regime) pair that matches
   `regimesByAlgoId` AND has a populated bucket at `(remaining,
   distanceBp)`. If no lookups, skip `no-bucket`.
8. For every (lookup, side) tuple, derive `ourProbability` (interpreted
   relative to `currentSide`) and `edge = ourProbability - bestBid`.
   Track the maximum edge per side across all lookups.
9. If both sides' bids are missing, skip `no-bid`.
10. Pick the side with the larger maximum edge as the trade side.
11. If the winning edge is below `minEdge`, skip `thin-edge`.
12. If the winning side's `ourProbability` is below `MIN_MODEL_PROBABILITY`
    (0.55), skip `low-confidence`.
13. Otherwise return `trade` with `winningRegime = (algoId, regime,
    probability, samples)`.

Skip reasons:

- `warmup`
- `out-of-window`
- `too-close-to-line`
- `no-bucket`
- `no-bid`
- `thin-edge`

Trade side:

- The decision can choose up or down.
- It buys a YES token for the selected side.
- It compares modeled probability to the current venue bid because the bot is
  maker-only and posts at the bid. Buying at ask would be taker behavior and is
  not used.

## Vendor Abstraction

Source:

- `src/lib/trading/vendor/types.ts`

The live and dry-run runners depend on this interface, not directly on
Polymarket. The implementation comment says Kalshi/Hyperliquid could be added
as new vendor directories later.

Core vendor types:

- `TradableMarket`: asset, window start/end, vendor market ref, up token ref,
  down token ref, accepting-orders flag, optional display label.
- `TopOfBook`: best bid and ask, nullable.
- `UpDownBook`: market, up book, down book, fetched-at time.
- `PlacedOrder`: order id, side, outcome ref, limit price, shares if filled,
  fee bps, placed-at time.
- `CancelResult`: accepted flag, terminal flag, optional error message.
- `FillEvent`: venue-normalized fill event.
- `MarketHydration`: open order plus cumulative fill state for one market.
- `LifetimePnlScanResult`: lifetime PnL and scan counts.

Vendor methods:

- `discoverMarket`
- `fetchBook`
- `placeMakerLimitBuy`
- `cancelOrder`
- `streamUserFills`
- `hydrateMarketState`
- `scanLifetimePnl`

`PostOnlyRejectionError` is a typed error used to distinguish normal maker-only
crossing rejections from generic placement failures.

## Polymarket Integration

Polymarket-specific implementation lives under:

- `src/lib/trading/vendor/polymarket`
- `src/lib/polymarket`

### Auth

Source:

- `src/lib/polymarket/getPolymarketClobClient.ts`

Behavior:

- Auth is lazy by default.
- Live trading calls the Polymarket vendor with `eagerAuth: true` to fail fast.
- It reads `POLYMARKET_PRIVATE_KEY` and `POLYMARKET_FUNDER_ADDRESS`.
- It creates an ethers wallet from the private key.
- It constructs an unauthenticated CLOB client to fetch server time and create
  or derive the L2 API key bundle.
- It uses nonce 0 for L1 API credential auth. V2 order signing does not
  submit an order nonce.
- It checks Polymarket server time against local clock.
- If absolute clock drift exceeds 30 seconds, initialization fails.
- It memoizes the authenticated client and credential state for the process.
- It does not persist API credentials to disk.
- `resetPolymarketClobClient` clears the memoized client.

Auth check command:

- `bun alea polymarket:auth-check`

Checks:

1. L1 EIP-712 credential derivation and clock offset.
2. L2 HMAC by listing API keys.
3. Funder recognition via collateral balance/allowance.
4. L2 GET open orders.
5. User websocket subscription for three seconds.
6. Local order signing dry-run on a representative token.

No orders are posted by the auth check.

### Market Discovery

Source:

- `src/lib/trading/vendor/polymarket/discoverMarket.ts`

Behavior:

- Polymarket 5-minute slug pattern:
  `<asset>-updown-5m-<windowStartUnixSeconds>`.
- Calls Gamma API `GET /events?slug=<slug>`.
- Expects one binary market with outcomes exactly `Up` and `Down`.
- Parses `clobTokenIds`, which are stringified JSON arrays.
- Returns null if the event or market is missing or malformed.
- Returns a `TradableMarket` where:
  - `vendorRef` is the condition id.
  - `upRef` and `downRef` are CLOB token ids.
  - `acceptingOrders` comes from Gamma market data, default false.
  - `displayLabel` is the slug.
- Also returns `negRisk`, cached in the factory by condition id.

### Book Fetching

Source:

- `src/lib/trading/vendor/polymarket/fetchBook.ts`

Behavior:

- Calls public CLOB REST `/book?token_id=<tokenId>` twice in parallel, once
  for up and once for down.
- Parses bid and ask levels with Zod.
- Scans levels to pick best bid and best ask instead of trusting array order.
- Ignores non-finite or zero/negative size levels.
- Returns null bid/ask when no usable resting level exists.

### Maker-Only Placement

Source:

- `src/lib/trading/vendor/polymarket/placeMakerLimitBuy.ts`

Behavior:

- Only BUY orders are placed.
- Orders are GTD and expire before the five-minute window close.
- `postOnly: true` is passed to Polymarket CLOB.
- `feeRateBps` is not submitted on V2 orders; fees are read from venue
  metadata and historical trade records.
- Limit price is floored to the venue-provided tick size.
- Shares are computed as `stakeUsd / tickedPrice`, rounded down to two decimal
  share quantum so notional cost stays at or below stake.
- `negRisk`, tick size, minimum order size, fee metadata, and minimum order age
  are hydrated from the venue and cached by condition id.
- Polymarket's free-form post-only rejection phrases are translated into
  `PostOnlyRejectionError`.
- Unknown placement failures throw generic errors.

Post-only phrase matching looks for variants of:

- `post only`
- `postonly`
- `would match`
- `would cross`
- `would taker`
- `would fill`

### Cancels

Source:

- `src/lib/trading/vendor/polymarket/cancelOrder.ts`

Behavior:

- Calls `client.cancelOrder`.
- Treats orders in the returned `canceled` list as accepted and terminal.
- Treats certain not-canceled reasons as terminal if they indicate already
  closed, filled, matched, canceled, cancelled, or not found.
- Network/client errors return accepted false and terminal false so the runner
  keeps tracking the order id.

### Market Hydration

Source:

- `src/lib/trading/vendor/polymarket/hydrateMarketState.ts`

Behavior:

- Calls `getOpenOrders({ market })` and `getTrades({ market })` in parallel.
- Picks the newest BUY open order for either up/down token.
- Aggregates trades for up/down tokens into shares filled, cost, fees, and
  weighted average fee bps.
- Maker trades are treated as zero-fee.
- Returns a vendor-neutral `MarketHydration`.

### User Fill Stream

Source:

- `src/lib/trading/vendor/polymarket/streamUserFills.ts`

Behavior:

- Opens Polymarket CLOB `/ws/user`.
- Authenticates on every connect with L2 credential fields.
- Subscribes with `markets` as condition ids.
- Builds a token-id-to-side map for active markets.
- Reconnect delays are `[1000, 2000, 5000, 10000, 30000]` ms.
- Parses trade frames and maps them into vendor-neutral `FillEvent`s.
- Order status frames are observed but not surfaced; runner derives order state
  from fills plus placement/cancel lifecycle.

### Fees

Source:

- `src/lib/trading/vendor/polymarket/computePolymarketFeeUsd.ts`

Formula:

```txt
feeUsd = size * (feeRateBps / 10000) * price * (1 - price)
```

Behavior:

- Rounded to five decimal places.
- Returns zero for invalid inputs, zero/negative size, price outside `(0, 1)`,
  or non-positive fee rate.
- Maker trades are currently treated as zero fee by callers.

### Lifetime PnL Scan

Source:

- `src/lib/trading/vendor/polymarket/scanLifetimePnl.ts`
- `src/lib/trading/state/computeLifetimePnl.ts`

Behavior:

- Fetches all wallet trades via `getTradesPaginated`.
- Stops when the next cursor is missing, empty, or `LTE=`.
- Fetches unique market resolutions via `getMarket` with concurrency 10.
- Converts trades into a pure `ScanTrade` shape.
- Computes realized PnL only for resolved markets.
- Unresolved markets are skipped.

PnL formula per `(conditionId, tokenId)`:

- Shares: sum buys minus sells.
- Cash flow: negative buy cost plus sell proceeds.
- Fees: sum fee USD.
- Payout: signed shares times resolution price.
- PnL: cash flow plus payout minus fees.

### Trading Performance Scan

Command:

- `bun alea trading:performance`

Source:

- `src/lib/trading/vendor/polymarket/scanTradingPerformance.ts`
- `src/lib/trading/performance/buildTradingPerformancePayload.ts`
- `src/lib/trading/performance/renderTradingPerformanceHtml.ts`

Behavior:

- Authenticated read-only scan of full Polymarket CLOB trade history.
- Fetches every touched market.
- Builds per-trade rows, per-market rows, summary metrics, and cumulative PnL
  chart points.
- Resolves markets only when closed, has a winner, and binary token prices are
  0/1.
- Computes BUY/SELL trade PnL as cash flow plus resolved shares minus fees.
- Writes paired HTML and JSON files under `tmp/`.
- Does not touch the DB and does not place or cancel orders.

## Dry-Run Trader

Command:

```sh
bun alea trading:dry-run
```

Source:

- `src/bin/trading/dryRun.ts`
- `src/lib/trading/dryRun/runDryRun.ts`

Purpose:

- Runs the live decision and maker-order preparation path against real feeds
  without placing orders.
- Uses read-only vendor methods: `discoverMarket`, `fetchBook`,
  `prepareMakerLimitBuy`, `streamMarketData`, and `resolveMarketOutcome`.
- Does not open user fill stream.
- Does not hydrate lifetime PnL.
- Does not require Polymarket credentials.
- Requires Telegram token/chat id and sends explicitly labelled dry-run
  virtual-order and per-window summary messages.
- Writes a timestamped JSONL session ledger under `tmp/dry-trading/`.

Flow:

1. Create per-asset rolling 5m bar buffer (`RegimeTrackers`).
2. Hydrate `REGIME_TRACKER_BOOTSTRAP_BARS` (70) closed five-minute bars
   from the configured live price source.
3. Start the live price websocket for BBO ticks and five-minute close bars.
4. Discover markets, poll books, and subscribe to Polymarket public market
   websocket updates for active token IDs.
5. Tick every 250 ms.
6. On window rollover, create new per-asset window state and asynchronously
   discover markets.
7. Use the same freshness checks and `evaluateDecision` path as live trading
   (multi-algo greedy across promoted leading-regime tables).
8. On TAKE, force a just-in-time book refresh, re-evaluate, prepare the maker
   GTD order through the vendor, then create a virtual order.
9. Simulate queue-aware fills from `last_trade_price` events and write
   `window_checkpoint` / `window_finalized` JSONL records.

Dry-run differences from live:

- Dry-run prepares but never signs, posts, or cancels orders.
- Dry-run uses the public market websocket for simulated fills and official
  resolution, with REST outcome lookup as fallback.
- Dry-run tracks canonical queue-aware fills plus touch/all-filled/unfilled
  counterfactual metrics. Live tracks real user fills and wallet PnL.
- Dry-run book poll interval is 2000 ms. Live uses 1500 ms.

## Market Capture and Replay

### Capture (`data:capture`)

Source: `src/lib/marketCapture/`, `src/bin/data/capture.ts`.

Long-running daemon that records every Polymarket / Binance USDT-M perp /
Coinbase Advanced Trade (spot + INTX perp) / Polymarket-RTDS Chainlink WS
event into a per-window JSONL file under `tmp/market-capture/<UTC-day>/` and
bulk-loads the rotated file into the `market_event` Postgres table on each
5-minute boundary. Recovery on startup picks up any orphaned `.jsonl` files
and loads them before the new writer's window opens. The rollover hook runs
on a separate sequential chain so a stuck Postgres ingest cannot wedge the
writer's main queue (commit `0666e9e`).

`market_event` schema: one row per WS event with `(ts_ms, received_ms,
source, asset, kind, market_ref, payload jsonb)`. Indexed by `ts_ms`,
`(source, asset, ts_ms)`, and partial `(market_ref, ts_ms) WHERE market_ref
IS NOT NULL`.

### Replay (`trading:replay` / `trading:replay-report`)

Source: `src/lib/trading/replay/`, `src/bin/trading/replay.ts`,
`src/bin/trading/replayReport.ts`.

Walks every captured 5-minute window through the live decision +
maker-order + fill-simulation pipeline. Reuses `evaluateDecision`,
`fillSimulation`, the dry-run telemetry builders, and the dry-run
metrics module verbatim. Output JSONL is bit-compatible with the
dry-run report parser; `trading:replay-report` is a duplicate of
`trading:dry-run-report` (lightly rebranded) so divergence later is
intentional rather than accidental.

Flow:

1. Manifest scan: stream every polymarket event in the replay range to
   build `(asset, windowStart) → ReplayMarket`. Up/down comes from the
   captured `resolved` event for each market.
2. Pre-load chainlink reference-price events into per-asset arrays.
3. Per-asset per-window: hydrate `RegimeTrackers` from the local
   `candles` table (binary-search slice for the bootstrap window).
4. Per-window: walk the window's events in time order, dispatching to
   binance bbo handler / polymarket book/trade/bba handlers, with
   minute-boundary triggers for evaluation; calls `evaluateDecision`
   and the simulator just like live.
5. At window end: resolve the winning side from chainlink (truth) and
   cross-check against the captured polymarket `resolved` event.
   Disagreements counted in the dashboard's "Settlement mismatch" stat.
   A window with missing chainlink coverage logs an error and excludes
   that asset's bet from PnL — single bad windows don't blow away
   multi-day replays.

Limitations: replay needs candles synced through to the start of the
captured range (`bun alea candles:sync`), needs capture to have
started before `windowStart` (line capture window is `MAX_LINE_CAPTURE_LAG_MS`
= 5s), and needs the polymarket `resolved` event (~1.5min after
window-end) for up/down assignment — capture should run at least 2min
past the last replayable window.

## Live Trader

Command:

```sh
bun alea trading:live --commit
```

Source:

- `src/bin/trading/live.ts`
- `src/lib/trading/live/runLive.ts`
- `src/lib/trading/live/*`

Startup gates:

- Probability table must be non-empty.
- `--commit` is required. Without it, the command refuses to start.
- Telegram token and chat id must be present.
- Polymarket private key and funder address must be present.
- Polymarket vendor is created with `eagerAuth: true`.

Core runtime:

- Long-running daemon.
- Uses Binance perp live feed for underlying BBO and closed five-minute bars.
- Uses Polymarket as the venue through the vendor abstraction.
- Polls Polymarket books.
- Watches Polymarket user fills.
- Places maker-only GTD BUY orders.
- Cancels residual orders before window close.
- Settles filled slots after the Binance five-minute close.
- Sends Telegram alerts for placements and summaries.

Important constants:

- Tick loop: 250 ms.
- Book poll: 1500 ms.
- Cancel residual orders: 10 seconds before window end.
- Window summary: 8 seconds after window end.
- Stake per trade: 20 USD.
- Minimum modeled edge: 0.05 by default.

### Live State Model

Window state:

- `WindowRecord`
  - window start/end.
  - per-asset records.
  - summary sent flag.
  - cancel timer.
  - wrap-up timer.
  - rejected post-only count.
  - placed-after-retry count.
  - settlement retry count.

Per-asset state:

- `AssetWindowRecord`
  - asset.
  - market or null.
  - hydration status: pending, ready, failed.
  - line price or null.
  - line captured time or null.
  - last decision remaining bucket.
  - slot.

Slot variants:

- `empty`: no order or position for that asset/window.
- `active`: market, side, outcome ref, optional order id, limit price, shares
  if filled, shares filled, cost, fees, average fee bps.
- `noFill`: terminal unfilled order.
- `settled`: terminal filled outcome with PnL.

Index/cache:

- `ConditionIndex`: vendor market id to `(windowStartMs, asset)`.
- `BookCache`: latest book by vendor market id.
- `LifetimePnlBox`: mutable boxed numeric accumulator.

Concurrency invariant:

- Per asset/window, at most one open order or position.
- The slot is changed to active before asynchronous placement starts, so later
  ticks cannot double-fire placement.

### Live Freshness Rules

Source:

- `src/lib/trading/live/freshness.ts`

Constants:

- `MAX_LIVE_TICK_AGE_MS = 2000`
- `MAX_LINE_CAPTURE_LAG_MS = 5000`
- `MAX_BOOK_AGE_MS = 3000`

Rules:

- Tick reference time is exchange time if provided, otherwise local receipt
  time.
- Tick is fresh only if reference time is at or after window start, receipt
  time is not more than one second in the future, and received age is <= 2s.
- A tick can capture the line only if fresh and reference time is <= window
  start + 5s.
- Book is usable only if it matches market vendor ref, was fetched after window
  start, is not future-dated by more than one second, and is <= 3s old.
- EMA/ATR readiness requires the tracker to have a current value and its last
  incorporated bar open time to equal `windowStartMs - FIVE_MINUTES_MS`.
- Exact settlement bar requires bar open time exactly equal to the market
  window start.

### Live Boot Flow

1. Emit startup line with vendor, assets, stake, min edge, wallet prefix.
2. Bootstrap lifetime PnL:
   - Load `tmp/lifetime-pnl.json` if wallet matches.
   - Reconcile against full vendor trade history on startup.
   - Persist scan result.
   - On scan failure after a checkpoint loaded, keep the checkpoint and log a
     warning.
   - On scan failure without a checkpoint, log error and start from zero.
3. Create per-asset rolling 5m bar buffers (`RegimeTrackers`).
4. Hydrate buffers from recent Binance five-minute bars
   (`REGIME_TRACKER_BOOTSTRAP_BARS` = 70).
5. Open Binance perp websocket.
6. Initialize maps for last tick, books, closed bars, windows, condition index.
7. Build user fill stream subscription whenever discovered markets change.
8. Start book polling timer.
9. Start 250 ms tick timer.

### Live Window Flow

On each tick:

1. Determine current five-minute window start.
2. If no window record exists, create one.
3. For every asset in the new window:
   - Start asynchronous market discovery and venue state hydration.
   - Add discovered condition id to condition index.
   - Restart user fill stream to include active markets.
4. Schedule cancel and wrap-up timers for the window.
5. For each asset, run `stepAsset`.

Line capture:

- If record line is null and latest tick can capture line, set line to tick mid
  and record capture time.

Decision cadence:

- Compute floored remaining bucket.
- If remaining is null, set last decision remaining to null and return.
- Re-evaluate when remaining bucket changes, or while slot is still empty.
- Once a slot is non-empty, stop re-evaluating for placement purposes.

Live `stepAsset` prerequisites:

- Record exists.
- Latest tick exists and is fresh.
- Per-asset bar buffer exists.
- Buffer's last accepted bar ends at `windowStart - 5min` (training-pipeline convention; if the buffer missed a kline-close, the REST hydration helper catches it on the next tick).
- Market exists, hydration status is ready, line is captured, book is fresh.

Then it calls `evaluateRecordDecision`, which folds the buffer into a
`RegimeClassifierInput` and invokes `evaluateDecision`. The decision
evaluator handles its own warmup logic: if no algo classifies, it
returns `skip` with `reason: "warmup"`.

### Market Hydration

Source:

- `src/lib/trading/live/marketHydration.ts`

Bar-buffer hydration:

- Fetches `REGIME_TRACKER_BOOTSTRAP_BARS` (70) closed five-minute
  Binance perp bars per asset.
- Appends them into the per-asset `RegimeTrackers`.
- Logs current buffer state (count + last bar timestamp) or warming.
- On failure, logs warning and continues; decisions remain in warmup
  until the buffer has seeded.

Asset market hydration:

1. Discover venue market for asset/window.
2. If missing, mark hydration failed and skip trading this asset for that
   market.
3. Set `record.market`.
4. Index condition id.
5. Restart user stream subscription.
6. Call `vendor.hydrateMarketState`.
7. Convert hydration into active slot if open order or fills exist.
8. On hydration failure, mark failed and disable trading for that market.

### Placement and Retry

Source:

- `src/lib/trading/live/placement.ts`

Placement preconditions:

- Signal not aborted.
- Not within `ORDER_CANCEL_MARGIN_MS + 1000` of window end.
- Market exists and accepts orders.
- Hydration status is ready.
- Current decision still says trade.

Loop behavior:

- Holds active placeholder slot while the loop runs.
- Re-evaluates decision with current tick, current trackers, and current book
  before every attempt.
- Posts maker-only limit buy through vendor at the chosen bid.

On success:

- Updates active slot with order id unless cumulative fills already equal or
  exceed placed shares.
- Preserves fills that may have arrived during placement.
- Increments `placedAfterRetryCount` if there were prior post-only rejections.
- Emits `order-placed`.
- Sends Telegram order message fire-and-forget.

On post-only rejection:

- Increments `window.rejectedCount`.
- Logs info only, no Telegram.
- Fetches a fresh book.
- Sleeps 250 ms.
- Re-evaluates and retries.

On generic placement error:

- Treats the outcome as ambiguous because the POST may have reached the venue.
- Calls `vendor.hydrateMarketState`.
- If venue state shows an order or fill, adopts it and emits order/fill plus a
  warning.
- If no venue state exists, clears the slot, emits error, and sends Telegram
  error alert.

### Fills

Source:

- `src/lib/trading/live/applyFill.ts`

Behavior:

- Ignores fills when slot is not active.
- Ignores fills for a different outcome ref.
- Adds fill size to shares filled.
- Adds fill price times size to cost.
- Computes fill fee via Polymarket fee formula.
- Adds fees.
- Updates share-weighted average fee bps.
- Clears order id when cumulative shares reach placed share size.
- Emits fill event.

### Cancels

Source:

- `src/lib/trading/live/cancelResidualOrders.ts`

Behavior:

- Runs for active slots with non-null order id.
- Calls vendor cancel up to three attempts.
- Retry delay is 250 ms.
- If cancel accepted or terminal, clears local order id.
- Logs info or warning with result.

### Settlement and Window Summary

Sources:

- `src/lib/trading/live/settleRecord.ts`
- `src/lib/trading/state/settleFilled.ts`
- `src/lib/trading/live/wrapUpWindow.ts`
- `src/lib/trading/telegram/formatWindowSummary.ts`

Settlement convention:

- Uses Binance perp final close, not the Polymarket Chainlink oracle.
- Winning side is up if `finalPrice >= line`, else down.
- Ties resolve up.
- If line is missing after restart but exact settlement bar exists, it uses
  the exact bar open as the recoverable line.

PnL:

- If active slot has zero shares filled, it becomes `noFill`.
- If filled and winning, gross payout is `sharesFilled * 1`.
- Gross PnL is payout minus cost.
- Net PnL is gross PnL minus fees.
- Losing side payout is zero.
- Average fill price is `costUsd / sharesFilled`.

Wrap-up flow:

1. Fetch exact missing settlement bars for filled slots if needed.
2. Settle every per-asset record.
3. If any outcome is pending because settlement bar is missing, schedule retry
   after 2000 ms and increment settlement retry count.
4. Once all settled, mark summary sent.
5. Add window net PnL to lifetime accumulator.
6. Persist `tmp/lifetime-pnl.json` before Telegram.
7. Format and emit window summary.
8. Send Telegram summary.
9. Remove condition-index entries.
10. Delete the window from active window map.

Telegram sends:

- Order placement/error alerts are fire-and-forget.
- Window summary is awaited.
- Telegram failure logs warning and does not stop trading.

## Lifetime PnL Store

Source:

- `src/lib/trading/state/lifetimePnlStore.ts`
- `src/lib/trading/live/lifetimePnlBootstrap.ts`

Path:

- `tmp/lifetime-pnl.json`.

Behavior:

- Stores wallet address, lifetime PnL USD, and as-of time.
- Writes atomically.
- Live bootstrap always does a venue-truth reconciliation scan.
- If full scan succeeds, persists checkpoint.
- If full scan fails after a checkpoint loaded, live runner keeps the loaded
  checkpoint and logs a warning.
- If full scan fails without a checkpoint, live runner logs error and starts
  lifetime total at zero.
- Operator can manually rescan with `trading:hydrate-lifetime-pnl`.

## Telegram Integration

Generic sender:

- `src/lib/telegram/sendTelegramMessage.ts`

Behavior:

- Calls Telegram Bot API `sendMessage`.
- Requires non-empty text.
- Supports plain text or Markdown parse mode.
- Parses JSON response.
- Validates success and error response shapes with Zod.
- Throws descriptive errors on non-2xx or Telegram `ok: false`.

Command:

- `bun alea telegram:test`

Trading message formatters:

- `formatOrderPlaced`
- `formatOrderError`
- `formatWindowSummary`

Window summary content:

- Per-asset no trade/unfilled/pending/traded won/lost lines.
- Latest window PnL.
- Optional cross-book rejection counts.
- Lifetime total PnL.

## Dashboards and UI

Shared design system:

- `src/lib/ui/aleaDesignSystem.ts`.

It provides:

- Inline font links.
- CSS tokens.
- Base page shell/header/main layout.
- Cards, tabs, tables, tooltips, legends, section rules.
- Dice mark and Alea wordmark.
- Chart color tokens.

Design identity:

- Dark near-black page.
- Deep felt-green panels.
- Antique gold borders/rules/accent states.
- Warm ivory text.
- Cormorant Garamond for display/title.
- Inter for general UI.
- uPlot for charts.
- No JS framework for temp dashboards.

Dashboard contract from docs:

- Standalone `.html` under `tmp/`.
- Companion `.json` sidecar next to it.
- JSON is source of truth.
- HTML is a view.
- Auto-opened on macOS unless `--no-open`.
- Renderers are pure payload-to-HTML functions.

Dashboard-producing commands:

- `latency:capture`
- `latency:chart`
- `reliability:capture`
- `reliability:chart`
- `training:distributions`
- `trading:performance`

## Tests

Test command:

```sh
bun run test
```

The suite currently has 59 test files. It is heavily unit-test oriented and
avoids network and database calls in tests, consistent with the coding
conventions.

Covered areas include:

- Candle timeframe/window alignment and source/product mapping.
- Candle sync summarization.
- CLI parser and app runner behavior.
- Exchange price interpolation, densification, and consensus series.
- Exchange-specific websocket frame parsers.
- Live price five-minute window helpers.
- Regime tracker rolling-buffer mechanics.
- Regime classifier input + algo classify functions.
- Reliability feed parsers, directional outcome, window finalization, and
  renderer.
- Probability generation and lookup.
- Decision evaluator.
- Dry-run formatter.
- Live trading fill, cancel, freshness, market hydration, placement,
  settlement, and utility behavior.
- Lifetime PnL math and store.
- Telegram formatters.
- Polymarket vendor adapter methods.
- Training cache, percentiles, candle size distribution, survival snapshots,
  survival distribution, filters, registry, and filter scoring.
- Trading performance payload and renderer.

I did not run the full test suite while creating this handoff because the
deliverable is documentation-only.

## Research Notes Summary

### Filter Scoring Overhaul

File:

- `doc/research/2026-05-04-filter-scoring-overhaul.md`

Core finding:

- The original signed-area score versus global baseline biased against
  high-skip filters.
- Both halves of a high-skip filter could appear negative versus global
  baseline because skipped snapshots had different rates.
- Per-cell scoring was moved to a filter-conditioned baseline.
- Headline scoring became log-loss information gain versus global baseline,
  normalized by population snapshots.

Outcome:

- `distance_from_line_atr` became the clear single-filter champion.
- `distance_atr_with_ema_aligned`, the earlier compound, became worse than
  its parent once skip-selection bias was handled.
- Rare orthogonal filters such as RSI-extreme looked interesting for future
  compounds but were not kept active.

### Filter Archive

File:

- `doc/research/2026-05-04-filter-archive.md`

Core finding:

- Of 28 historical filters, only two are currently kept in code:
  `distance_from_line_atr` and `ema_50_5m_alignment`.
- The other 26 were removed and documented with scores and intuition.
- Archive scores were computed with an older 300 sample floor and should not
  be treated as current absolute values.

### Sample Floor

File:

- `doc/research/2026-05-04-sample-floor.md`

Core finding:

- A 300 sample floor let low-bp artifacts into scoring for the ATR-distance
  filter.
- At very low bp, only unusually low-ATR moments could satisfy
  `distance >= 0.5 * ATR`, so those buckets mixed volatility regime with
  distance-from-line.
- Floor was raised to 2000 for training scoring/rendering/sweet spot
  computation.
- This reduced apparent population calibration but increased restricted
  sweet-spot calibration and tightened coverage.

### Sweet Spot

File:

- `doc/research/2026-05-04-sweet-spot.md`

Core concept:

- The sweet spot is the narrowest contiguous bp range that captures most of a
  filter's positive information gain.
- It is a discipline rule to avoid trusting filter probabilities outside the
  distances where the filter earns its edge.
- The methodology note discusses 70/80/90 percent thresholds.
- Current source code uses 80 percent.

## Review-Relevant Source Facts

These are not recommendations. They are factual details worth keeping visible
while reviewing the current implementation.

1. Current `computeSweetSpot.ts` source has
   `SWEET_SPOT_INFO_GAIN_THRESHOLD = 0.80`. The committed generated probability
   table has sweet-spot ranges matching the 70 percent post-floor ranges in the
   sample-floor research note. The live app uses the generated table at runtime
   until it is regenerated.

2. Training scoring/sweet-spot sample floor is 2000. Probability table bucket
   materialization floor is 200 by default. These are separate floors in code.

3. The pure decision evaluator allows `ema50` to be null. Live `stepAsset`
   requires EMA readiness before evaluating. Placement retry's current-decision
   path only requires ATR readiness. This means the first live evaluation in a
   window has a stricter EMA prerequisite than the pure evaluator and retry
   helper.

4. The code settles live window PnL using Binance perp five-minute close, while
   Polymarket resolves on Chainlink. This is documented as an accepted proxy
   tradeoff, and wallet USDC balance is treated as the ultimate source of
   truth.

## External Dependencies and Endpoints

Database:

- Local PostgreSQL.
- Default URL `postgres://localhost:5432/alea`.

Binance:

- Historical spot candles through Binance data API.
- Historical futures/perp candles through Binance Vision archives.
- Live/recent futures bars and websocket through `fapi.binance.com`.
- Binance Futures access may require non-US network.

Coinbase:

- Advanced Trade REST for candles.
- Advanced Trade websocket for latency/reliability feeds.

Polymarket:

- Gamma API for event/market discovery.
- CLOB REST for books, orders, cancels, open orders, trades, markets, balance,
  allowance, server time, API keys.
- CLOB user websocket for fills.
- RTDS websocket for Chainlink crypto price feed.

Telegram:

- Bot API `sendMessage`.

Cloudflare/Wrangler:

- Only used by `training:distributions --deploy`.

CDNs:

- Dashboard HTML pulls uPlot and Google Fonts from public CDNs.

## Operational Files Written by the App

Under repo-local `tmp/`:

- Latency HTML/JSON captures.
- Reliability HTML/JSON captures.
- Training distribution HTML/JSON.
- Probability table JSON sidecars.
- Trading performance HTML/JSON.
- `tmp/lifetime-pnl.json`.
- `tmp/cache/training-distributions/*`.
- `tmp/web/*` for training dashboard deploy.

Generated source artifact:

- `src/lib/trading/probabilityTable/probabilityTable.generated.ts`.

The generated probability table is intentionally committed so model changes are
visible in code review.

## End-to-End Data Flow

Historical data flow:

1. `candles:sync` fetches candles from Binance/Coinbase.
2. `upsertCandles` writes OHLCV into Postgres.
3. `candles:fill-gaps` repairs missing bars.
4. `training:distributions` reads candles, computes survival/filter
   surfaces (legacy benchmarking) and per-(algo, regime) regime surfaces,
   and writes dashboard artifacts.
5. `trading:gen-probability-table` reads candles, runs every algo in the
   regime registry, persists `LeadingRegimeTable`s for every (algo,
   regime) pair clearing `LEADING_REGIME_MIN_LEAD_PP` (1.0pp avg lead),
   and writes the committed probability table.

Research validation flow:

1. `latency:capture` records live quote streams and Polymarket Chainlink RTDS
   to compare lead/lag.
2. `reliability:capture` records live five-minute directional agreement
   between exchange proxies and Polymarket Chainlink.
3. Dashboard and JSON outputs provide audit trails.

Capture and replay flow:

1. `data:capture` opens long-running WS subscriptions to Polymarket,
   Binance, Coinbase, and Polymarket-RTDS Chainlink, writes JSONL per
   5m window under `tmp/market-capture/`, and bulk-loads each rotated
   file into the `market_event` Postgres table.
2. `data:ingest-pending` reloads any orphaned JSONLs (recovery after
   crash, after `--no-ingest`, or after a Postgres outage).
3. `trading:replay` walks each captured 5m window through the same
   `evaluateDecision` + `fillSimulation` pipeline live uses, with
   chainlink reference-price events as settlement truth and the
   captured polymarket `resolved` event as cross-check. Output JSONL
   under `tmp/replay-trading/` is bit-compatible with the dry-run report.
4. `trading:replay-report` renders the session HTML.

Dry-run trading flow:

1. Load committed probability table.
2. Create lazy Polymarket vendor without credentials.
3. Hydrate the per-asset rolling 5m bar buffer (`RegimeTrackers`) from the
   injected live price source.
4. Stream live price ticks and close bars.
5. Discover Polymarket markets.
6. Poll books and stream public market data.
7. Run the multi-algo greedy evaluator and prepare virtual maker orders
   through the vendor.
8. Simulate queue-aware fills and official-first settlement.
9. Append JSONL session/window/order records under `tmp/dry-trading/`.

Live trading flow:

1. Load committed probability table.
2. Validate `--commit` and required env.
3. Create eager-auth Polymarket vendor.
4. Bootstrap lifetime PnL.
5. Hydrate the per-asset rolling 5m bar buffer (`RegimeTrackers`).
6. Stream Binance perp ticks and close bars.
7. Discover/hydrate each Polymarket market per five-minute window.
8. Poll books.
9. Stream user fills.
10. Capture line.
11. Evaluate decisions (multi-algo greedy across promoted regimes).
12. Place maker-only limit BUY orders if edge passes.
13. Retry post-only rejections while edge remains.
14. Cancel residual orders before close.
15. Settle filled slots after close (capped at 30 retries / ~60s if a
    closing 5m bar is delayed; missing assets contribute 0 to PnL).
16. Persist lifetime PnL.
17. Send Telegram summary.

Performance reporting flow:

1. Authenticate with Polymarket.
2. Fetch full wallet trade history.
3. Fetch market resolution metadata for touched markets.
4. Compute per-trade, per-market, and lifetime PnL.
5. Write HTML/JSON dashboard.

## Review-Relevant Invariants

These are facts encoded in current code or docs.

- All training/trading side conventions tie exact equality to up.
- Live decision distance uses floored basis points and a small `1e-9` offset,
  matching training.
- Runtime probability lookup requires exact bucket match.
- Runtime skips distances under 2 bp.
- Production table currently stores only buckets inside each asset sweet spot.
- Live orders are post-only maker GTD buys with a pre-close expiration.
- Live runner never intentionally crosses the spread.
- Live runner only starts with `--commit`.
- Live runner requires Telegram credentials.
- Live runner stores only lifetime PnL on disk; other state is reconstructed
  from Polymarket or live feeds.
- Venue hydration occurs on every market discovery to recover open orders or
  partial fills after process restarts.
- Generic placement errors trigger venue reconciliation before the placeholder
  slot is cleared.
- Settlement/PnL is modeled from Binance close for summaries, while actual
  venue settlement is Chainlink and actual wallet balance is source of truth.
- Reliability experiment exists to measure exactly that proxy risk.
- Test policy avoids external systems in unit tests.

## Key Source File Map

CLI:

- `src/bin/index.ts`
- `src/bin/candles/sync.ts`
- `src/bin/candles/fillGaps.ts`
- `src/bin/db/migrate.ts`
- `src/bin/latency/capture.ts`
- `src/bin/latency/chart.ts`
- `src/bin/reliability/capture.ts`
- `src/bin/reliability/chart.ts`
- `src/bin/training/distributions.ts`
- `src/bin/trading/genProbabilityTable.ts`
- `src/bin/trading/dryRun.ts`
- `src/bin/trading/live.ts`
- `src/bin/trading/hydrateLifetimePnl.ts`
- `src/bin/trading/performance.ts`
- `src/bin/polymarket/authCheck.ts`
- `src/bin/telegram/test.ts`

Database/candles:

- `src/lib/db/*`
- `src/lib/db/migrations/202605021900_create_candles.ts`
- `src/lib/candles/*`

Live prices:

- `src/lib/livePrices/fiveMinuteWindow.ts`
- `src/lib/livePrices/regimeTrackers.ts` — per-asset rolling buffer of recently-closed 5m bars (replaces the old per-feature trackers)
- `src/lib/livePrices/regimeContext.ts` — folds the bar buffer into a `RegimeClassifierInput` per decision
- `src/lib/livePrices/ensureTrackersReadyForWindow.ts` — REST fallback when a kline-close was missed
- `src/lib/livePrices/source.ts` and `src/lib/livePrices/types.ts`
- `src/lib/exchangePrices/sources/binance/streamBinancePerpQuotes.ts` (multi-asset BBO + kline + reconnect; trader consumes via the adapter at `src/lib/livePrices/binancePerp/source.ts`)
- `src/lib/wsClient/createReconnectingWebSocket.ts` (shared auto-reconnect WS client used by every long-running stream)
- `src/lib/livePrices/binancePerp/fetchRecentFiveMinuteBars.ts`

Training:

- `src/lib/training/loadTrainingCandles.ts`
- `src/lib/training/computeCandleSizeDistribution.ts`
- `src/lib/training/computePercentiles.ts`
- `src/lib/training/computeSurvivalSnapshots.ts`
- `src/lib/training/computeSurvivalDistribution.ts`
- `src/lib/training/survivalFilters/types.ts`
- `src/lib/training/survivalFilters/registry.ts`
- `src/lib/training/survivalFilters/applySurvivalFilters.ts`
- `src/lib/training/survivalFilters/computeSweetSpot.ts`
- `src/lib/training/survivalFilters/distanceFromLineAtr/filter.ts`
- `src/lib/training/survivalFilters/ema505mAlignment/filter.ts`
- `src/lib/training/cache/*`
- `src/lib/training/renderTrainingDistributionsHtml.ts`

Trading:

- `src/lib/trading/types.ts`
- `src/lib/trading/computeAssetProbabilities.ts`
- `src/lib/trading/lookupProbability.ts`
- `src/lib/trading/decision/evaluateDecision.ts`
- `src/lib/trading/probabilityTable/probabilityTable.generated.ts`
- `src/lib/trading/probabilityTable/writeProbabilityTableModule.ts`
- `src/lib/trading/dryRun/runDryRun.ts`
- `src/lib/trading/live/runLive.ts`
- `src/lib/trading/live/freshness.ts`
- `src/lib/trading/live/marketHydration.ts`
- `src/lib/trading/live/placement.ts`
- `src/lib/trading/live/applyFill.ts`
- `src/lib/trading/live/cancelResidualOrders.ts`
- `src/lib/trading/live/settleRecord.ts`
- `src/lib/trading/live/wrapUpWindow.ts`
- `src/lib/trading/state/*`
- `src/lib/trading/telegram/*`
- `src/lib/trading/vendor/types.ts`
- `src/lib/trading/vendor/polymarket/*`
- `src/lib/trading/performance/*`

Polymarket:

- `src/lib/polymarket/getPolymarketClobClient.ts`
- `src/lib/polymarket/verifyAuth.ts`
- `src/lib/polymarket/probeUserWebSocket.ts`

Experiments/dashboards:

- `src/lib/exchangePrices/*`
- `src/lib/reliability/*`
- `src/lib/ui/aleaDesignSystem.ts`
