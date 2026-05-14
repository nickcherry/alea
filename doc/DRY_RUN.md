# Dry Run

The dry-run loop is the bridge between offline committee backtests
and real trading: a long-running process that keeps recent Pyth and
Coinbase spot candles in memory, refreshes them just before each
market boundary, synthesizes the active Pyth candle from the latest
Pyth price, asks the committee to predict the next bar, and persists
every decision to `dry_run_decisions`. No real orders are placed. The
loop also simulates whether a configured pre-open Polymarket order
would have been eligible, placed, filled, or left unfilled.

Run it:

```sh
bun alea dry:run
```

By default the runner trades both `5m` and `15m`. Override the grid
with a comma-separated list:

```sh
bun alea dry:run --periods 15m
```

Stays running until SIGINT / SIGTERM. The committee logic is
identical to what live trading will use; see
[COMMITTEE.md](./COMMITTEE.md).

## What it does, per asset/period

For each configured period, defaulting to `5m,15m`, and each of the
5 supported assets (`btc`, `eth`, `sol`, `xrp`, `doge`):

1. **Hydrate** — load the most recent
   `TRADE_DECISION_HYDRATE_BARS` closed bars for that period for
   both sources. Pyth is the canonical price/settlement-proxy series;
   Coinbase spot carries volume for filters whose `barSource` is
   `"coinbase"`. The current value, 150, is wider than the
   classifier's 100-bar window and the deepest filter's
   `requiredBars`, so the first decision always has enough history
   when the source has coverage.
2. **Refresh** — `TRADE_DECISION_LEAD_TIME_MS = 90s` before each
   configured period boundary, fetch recent Pyth and Coinbase spot
   candles for that asset/period and upsert them into separate
   in-memory buffers by candle open time. Pyth refresh failures skip
   the decision; Coinbase refresh failures are soft, so volume-source
   filters abstain while Pyth-source filters can still vote.
3. **Synthesize + predict** — fetch the latest one-shot Pyth price,
   combine it with the active Pyth candle when available, and build a
   synthetic active candle for the about-to-finalize bar. Align the
   Coinbase buffer to the Pyth open-time timeline. Run the regime
   classifier on Pyth bars. Look up the committee roster for that
   period and regime. Apply the shared trade decision policy. If
   non-abstain, persist the decision; otherwise skip.
4. **Simulate order** — `DRY_RUN_ORDER_PLACEMENT_DELAY_MS = 0s`
   after the committee decision, read the live UP/DOWN book/BBO
   market data for the predicted side. The runner pre-discovers
   current and next markets before entry so the market subscription is
   already available when the simulated placement time arrives. If the
   observed predicted-side price is within the
   configured 50c window, place a pretend limit buy by bidding one tick
   below the predicted-side best ask, or one tick
   below 50c if no predicted-side ask has arrived yet. The runner then watches the
   latest known predicted-side ask until the target market closes.
   If the simulated limit never becomes executable, the row is marked
   `unfilled`.
5. **Score** — on later refreshes, once the target bar is present as
   a closed Pyth candle in the in-memory buffer, compare its close to
   the prediction. Update the pending row's `actual_close` + `won`.

The runner is single-threaded by design: all state lives in the
closure, no locking. Persistence is the only external side effect.

## Candle Snapshot Contract

Dry-run no longer keeps a Pyth candle websocket alive. It only needs a
decision snapshot shortly before each market opens, so the
runtime uses direct fetch/reconcile instead:

1. Startup hydrates Pyth and Coinbase spot closed bars into parallel
   rolling buffers.
2. At decision time, [`candleState.ts`](../src/lib/tradeDecision/candleState.ts)
   fetches recent Pyth Benchmark candles for the specific
   asset/period and upserts them into memory with no duplicate open
   times. This decision-time fetch uses a short timeout and no
   backoff retries; slow backfills should not hold the trading loop
   through the boundary.
3. It also fetches recent Coinbase spot candles into the Coinbase
   buffer. Coinbase is optional at decision time: if it errors,
   times out, or has an open-time gap inside a filter window, only
   the Coinbase-source filters abstain.
4. It then fetches a one-shot latest Pyth price via
   [`fetchLatestPythPrices`](../src/lib/livePrices/pyth/fetchLatestPythPrices.ts).
   If that price is older than
   `TRADE_DECISION_MAX_PRICE_AGE_MS`, the decision is skipped instead
   of trading stale state.
5. If Pyth has already returned the active partial candle, its
   open/high/low are used and the latest price becomes the synthetic
   close. If not, the prior closed candle's close is used as the
   fallback open and the latest price defines the active bar's close.

The remaining websocket in dry-run is the Polymarket market-data
stream used by order simulation. That stream is about fillability and
book state, not committee candle construction.

## Committee evaluation

At T-90s of each boundary, for each asset:

1. Classify the regime from the bar window (real history + the
   in-flight bar with Pyth's t-90s price as the synthetic close).
2. If the classifier returns `null`, abstain entirely. The 150-bar
   hydration makes this an edge case in practice.
3. Look up the roster bucket for `(asset, regime, period)` in
   `committee_selections`. Empty bucket → abstain.
4. Evaluate each rostered candidate's `predict` on the trailing bar
   window from its declared source: Pyth for price filters, Coinbase
   spot for volume filters. Coinbase gaps become abstains for that
   candidate.
5. Collapse votes to at most one active vote per `filter_id`. When
   multiple configs for a filter engage, the engaged config with the
   highest selected asset/regime `win_rate` counts.
6. Require the shared minimum-vote and consensus settings from
   [`src/constants/tradeDecision.ts`](../src/constants/tradeDecision.ts).
   With today's defaults this is simple majority after filter collapse;
   ties and all-abstain still abstain.
7. Persist if non-abstain.

## Order simulation

Dry-run order configuration lives in
[`src/constants/dryRun.ts`](../src/constants/dryRun.ts).

| Constant                                 |   Default | Meaning                                                                       |
| ---------------------------------------- | --------: | ----------------------------------------------------------------------------- |
| `DRY_RUN_ORDER_PLACEMENT_DELAY_MS`       |       0ms | Wait after the committee decision before simulating entry                     |
| `DRY_RUN_ORDER_PRICE_WINDOW_CENTS`       |        3c | Only consider predicted-side prices within `50c ± window`                     |
| `DRY_RUN_ORDER_DEFAULT_TICK_SIZE`        |        1c | Fallback tick when market metadata has not supplied one yet                   |
| `DRY_RUN_ORDER_NO_QUOTE_REFERENCE_PRICE` |   50c ref | Reference price used to bid one tick lower when no ask has arrived            |
| `DRY_RUN_ORDER_MAX_QUOTE_AGE_MS`         | unbounded | Use latest known quote; missing placement quotes fall back one tick below 50c |
| `DRY_RUN_MARKET_DISCOVERY_LEAD_MS`       |   30000ms | How early to pre-discover current and next Polymarket markets                 |

The order price uses the predicted outcome token: UP decisions look
at the UP token, DOWN decisions look at the DOWN token. For a DOWN
decision that is equivalent to moving lower in normalized UP-price
space, but the persisted order fields are always in predicted-side
token price terms.

Observed placement context comes from the midpoint of the latest known
predicted-side book/BBO quote when available. The simulated limit price
is one tick below the predicted-side best ask: aggressive enough to be
top-of-book when there is spread, but still maker-only because it does
not cross the ask. If the predicted-side ask has not arrived yet, the
simulator still places the pretend order at 50c. The tick comes from
Polymarket market metadata when available and falls back to one cent.
Fill simulation is stricter about the price source: a pretend limit buy
only fills when the predicted-side ask itself is known and less than or
equal to the simulated limit price. Trade prints are
intentionally not fill evidence, because seeing a trade does not prove
our resting order would have been next in queue.

Dry-run still records the average selected asset/regime win rate across
the effective winning voters after the same one-vote-per-filter collapse
used by the committee decision. That value is logged as order confidence
for analysis only; it no longer gates simulated order placement.

Market discovery is centralized in
[`src/lib/trading/vendor/polymarket/marketDiscoveryCache.ts`](../src/lib/trading/vendor/polymarket/marketDiscoveryCache.ts).
Dry-run uses it now; live trading should use the same cache when
order placement comes back so both paths pre-discover the exact market
window before trying to stream or trade it.

The committee is loaded once at startup and cached for the life of
the process. If you re-run `committee:select` while a dry-run is
live, the process won't pick up the new roster — restart it.
The loader only accepts rows tagged with the active training profile,
so changing the training window or outcome-label rule requires
refreshing both training artifacts and `committee_selections`.

## Persistence: `dry_run_decisions`

Append-only. One row per non-abstain decision. Schema:
[`202605120100_create_dry_run_decisions`](../src/lib/db/migrations/202605120100_create_dry_run_decisions.ts)
and the `market_regime` column added by
[`202605120200_dry_run_market_regime`](../src/lib/db/migrations/202605120200_dry_run_market_regime.ts).

| Column                  | Meaning                                                              |
| ----------------------- | -------------------------------------------------------------------- |
| `id`                    | bigserial PK                                                         |
| `ts_ms`                 | Open-time of the target bar (the bar being predicted)                |
| `decided_at_ms`         | Wall-clock when the prediction was made                              |
| `asset`, `period`       | Self-explanatory                                                     |
| `prediction`            | `'u'` or `'d'`                                                       |
| `synth_open`            | Pyth price snapshotted at T-90s — used as the bar's synthetic open   |
| `actual_open`           | Nullable audit column retained for legacy dry-run rows               |
| `regime_votes`          | JSON `{up, down, abstain}` totals after one-vote-per-filter collapse |
| `actual_close`          | Filled in once the target bar settles                                |
| `won`                   | 0/1, null until scored                                               |
| `market_regime`         | Classifier's read at decision time                                   |
| `decision_duration_ms`  | Committee/regime decision compute time before persistence            |
| `order_status`          | `pending_placement`, `filled`, `unfilled`, or a `skipped_*` reason   |
| `order_placed_at_ms`    | Simulated order-placement wall-clock                                 |
| `order_observed_price`  | Predicted-side token price read at simulated placement               |
| `order_limit_price`     | Simulated limit-buy price                                            |
| `order_confidence`      | Average effective winning-voter confidence recorded for analysis     |
| `order_filled_at_ms`    | When the simulated order first became fillable                       |
| `order_fill_price`      | Simulated fill price                                                 |
| `order_fill_latency_ms` | Milliseconds from simulated placement to first fillability evidence  |
| `order_expires_at_ms`   | Target market close; placed orders still unfilled here expire        |
| `order_market_ref`      | Polymarket condition id for the target window used by order simulation |
| `order_up_token_ref`    | Polymarket UP token id for that target window                        |
| `order_down_token_ref`  | Polymarket DOWN token id for that target window                      |

Abstain decisions are **not** written. Pending rows have
`actual_close = null` and `won = null`; the loop fills them in when
the target bar closes. Older rows created before order simulation are
marked `order_status = 'untracked'`.

`dry_run_decision_attempts` is the timing table for every scheduled
committee evaluation, including abstains. It records target window,
asset, period, regime, vote counts, roster size, decision duration, and
the linked `dry_run_decisions.id` when the attempt produced a trade.

## CLI output

The CLI streams one line per event:

```
13:21:05 hydrated 5m/btc bars=150
13:21:05 hydrated 15m/btc bars=150
...
13:21:05 loaded committee roster: 8 buckets, 592 candidates (selected_at=2026-05-13 15:35)
13:21:05 ready
13:24:55 UP     5m/eth   target=13:25 synth=2335.23 regime=low_vol_ranging roster=10 u=7 d=0 a=3
13:24:55 abstain 15m/btc   target=13:30 synth=80876.38 regime=low_vol_trending roster=10 u=0 d=0 a=10
...
13:25:01 WIN  5m/eth   bar=13:20 pred=u open=2329.42 close=2330.27
```

Event kinds: `hydrated`, `roster`, `ready`, `decision`, `order`,
`outcome`, `error`. See
[`bin/dry/run.ts`](../src/bin/dry/run.ts) for the styling
contract.

## Failure modes

- **Pyth refresh/latest failure** — the decision is skipped if recent
  candles cannot be fetched, the latest price is missing, or the
  latest price is stale. Logged as `error`; the next boundary retries
  with fresh fetches.
- **Stale committee roster** — the CLI startup line shows
  `selected_at`. If that's days old and the training artifact set has
  since expanded, the live committee is voting with an outdated
  candidate set. Operator's responsibility to rebuild + restart.
- **Empty roster bucket** — if `committee:select` finds zero
  qualifiers for a regime, decisions in that regime always
  abstain. Surfaces as `roster=0` in the log line. Lower the
  thresholds or add filters that work in that regime.
- **Hot-reload of selections** — not supported. Restart the loop.

## Dashboard

The dry-run results render as a separate page on the alea worker
under `/dryrun/`. The page reads `dry_run_decisions` at build time,
not live. It also renders the active trade decision constants next to
the performance metrics so the displayed hit rate is tied to the
policy that produced it. Refresh via `bun alea dashboards:build --deploy`. See
[DASHBOARDS.md](./DASHBOARDS.md) for the build contract and
[`src/lib/dryRun/dashboard/`](../src/lib/dryRun/dashboard/) for the
loader + renderer.

## Files

- [`src/lib/dryRun/runDryRun.ts`](../src/lib/dryRun/runDryRun.ts) —
  the main loop.
- [`src/lib/tradeDecision/candleState.ts`](../src/lib/tradeDecision/candleState.ts) —
  shared hydrate/refresh/synthesize candle state for dry-run and live
  trade decisions.
- [`src/lib/dryRun/orderSimulation.ts`](../src/lib/dryRun/orderSimulation.ts) —
  pre-open dry-run order placement + fill simulation.
- [`src/lib/trading/vendor/polymarket/marketDiscoveryCache.ts`](../src/lib/trading/vendor/polymarket/marketDiscoveryCache.ts) —
  shared current/next-window market discovery cache.
- [`src/lib/livePrices/pyth/fetchLatestPythPrices.ts`](../src/lib/livePrices/pyth/fetchLatestPythPrices.ts) —
  one-shot Hermes latest-price fetcher.
- [`src/lib/dryRun/dashboard/`](../src/lib/dryRun/dashboard/) —
  payload loader + HTML renderer.
- [`src/bin/dry/run.ts`](../src/bin/dry/run.ts) — the CLI.
