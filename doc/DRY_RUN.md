# Dry Run

The dry-run loop is the bridge between offline backtests and real
trading: a long-running process that streams live Pyth ticks, builds
synthetic bars at the boundary, asks the committee to predict the
next bar, and persists every decision to `dry_run_decisions`. No
real orders are placed. The loop also simulates whether a configured
post-open Polymarket order would have been eligible, placed, filled,
or left unfilled.

Run it:

```sh
bun alea dry:run
```

Stays running until SIGINT / SIGTERM. The committee logic is
identical to what live trading will use; see
[COMMITTEE.md](./COMMITTEE.md).

## What it does, per asset

For each of the 5 supported assets (`btc`, `eth`, `sol`, `xrp`,
`doge`):

1. **Hydrate** — load the most recent
   `TRADE_DECISION_HYDRATE_BARS` closed 5-minute bars from `candles`
   (pyth-spot canonical series). The current value, 150, is wider
   than the classifier's 100-bar window and the deepest filter's
   `requiredBars`, so the first decision always has enough history.
2. **Subscribe** — open one Pyth Hermes SSE stream for all 5 assets
   (multi-id query — one socket, all feeds). Ticks update an
   in-memory bar accumulator: each tick's price advances `high` /
   `low` / `close` of the current bar; crossing a 5-minute
   boundary finalizes the just-closed bar and starts a new one.
3. **Predict** — `TRADE_DECISION_LEAD_TIME_MS = 5s` before each
   5-minute boundary, snapshot the current Pyth price as the
   synthetic close of the about-to-finalize bar. Run the regime
   classifier. Look up the committee roster for that regime. Apply
   the shared trade decision policy. If non-abstain, persist the
   decision; otherwise skip.
4. **Simulate order** — `DRY_RUN_ORDER_PLACEMENT_DELAY_MS = 3s`
   after the target Polymarket market opens, read the live UP/DOWN
   book/BBO market data for the predicted side. The runner
   pre-discovers current and next markets before entry so the market
   subscription is already available when the simulated placement time
   arrives. If the observed predicted-side price is within the
   configured 50c window, and the average
   selected-regime win rate of the effective winning voters is at
   least the simulated limit price, place a pretend limit buy at
   `observed price + DRY_RUN_ORDER_LIMIT_OFFSET_CENTS`. The runner
   then watches fresh predicted-side ask quotes until the target
   market closes. If the simulated limit never becomes executable, the
   row is marked `unfilled`.
5. **Score** — when a closed bar's actual close arrives (via the
   normal tick-driven finalize on the next bar's first tick),
   compare to the prediction. Update the pending row's
   `actual_close` + `won`.

The runner is single-threaded by design: all state lives in the
closure, no locking. Persistence is the only external side effect.

## Pyth stream contract

[`streamPythHermes`](../src/lib/livePrices/pyth/streamPythHermes.ts)
is the SSE wrapper. Auto-reconnect with exponential backoff (1s →
30s cap), a stale-event watchdog (15s of silence triggers a
reconnect), and graceful handling of Hermes's 24h voluntary close.

Multi-asset subscription is cheap: one socket, all 5 assets
interleaved into the same event stream. Each tick is dispatched per
asset; the dry-run loop maintains a separate bar accumulator per
asset.

## Committee evaluation

At T-5s of each boundary, for each asset:

1. Classify the regime from the bar window (real history + the
   in-flight bar with Pyth's t-5s price as the synthetic close).
2. If the classifier returns `null`, abstain entirely. The 150-bar
   hydration makes this an edge case in practice.
3. Look up the roster bucket for `(regime, "5m")` in
   `committee_selections`. Empty bucket → abstain.
4. Evaluate each rostered candidate's `predict` on the same bar
   window.
5. Collapse votes to at most one active vote per `filter_id`. When
   multiple configs for a filter engage, the engaged config with the
   highest selected-regime `win_rate` counts.
6. Require the shared minimum-vote and consensus settings from
   [`src/constants/tradeDecision.ts`](../src/constants/tradeDecision.ts).
   With today's defaults this is simple majority after filter collapse;
   ties and all-abstain still abstain.
7. Persist if non-abstain.

## Order simulation

Dry-run order configuration lives in
[`src/constants/dryRun.ts`](../src/constants/dryRun.ts).

| Constant                           | Default | Meaning                                                       |
| ---------------------------------- | ------: | ------------------------------------------------------------- |
| `DRY_RUN_ORDER_PLACEMENT_DELAY_MS` |  3000ms | Wait after the target market opens before simulating entry    |
| `DRY_RUN_ORDER_PRICE_WINDOW_CENTS` |      3c | Only consider predicted-side prices within `50c ± window`     |
| `DRY_RUN_ORDER_LIMIT_OFFSET_CENTS` |    0.5c | Limit-buy offset above the observed predicted-side price      |
| `DRY_RUN_ORDER_MAX_QUOTE_AGE_MS`   |  2000ms | Maximum book/BBO quote age at placement or fill evaluation    |
| `DRY_RUN_MARKET_DISCOVERY_LEAD_MS` | 30000ms | How early to pre-discover current and next Polymarket markets |

The order price uses the predicted outcome token: UP decisions look
at the UP token, DOWN decisions look at the DOWN token. For a DOWN
decision that is equivalent to moving lower in normalized UP-price
space, but the persisted order fields are always in predicted-side
token price terms.

Observed placement price comes from the midpoint of a fresh
predicted-side book/BBO quote. If that side is unavailable, the
runner can infer the predicted-side midpoint from a fresh opposite
token midpoint. Fill simulation is stricter: a pretend limit buy only
fills when the predicted-side ask itself is fresh and less than or
equal to the simulated limit price. Trade prints are intentionally not
fill evidence, because seeing a trade does not prove our resting order
would have been next in queue.

The confidence gate uses the average selected-regime win rate across
the effective winning voters after the same one-vote-per-filter
collapse used by the committee decision. A simulated order is skipped
when `avg_confidence < limit_price`; in a zero-fee binary market this
is the direct expected-value check.

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

| Column                 | Meaning                                                              |
| ---------------------- | -------------------------------------------------------------------- |
| `id`                   | bigserial PK                                                         |
| `ts_ms`                | Open-time of the target bar (the bar being predicted)                |
| `decided_at_ms`        | Wall-clock when the prediction was made                              |
| `asset`, `period`      | Self-explanatory                                                     |
| `prediction`           | `'u'` or `'d'`                                                       |
| `synth_open`           | Pyth price snapshotted at T-5s — used as the bar's synthetic open    |
| `regime_votes`         | JSON `{up, down, abstain}` totals after one-vote-per-filter collapse |
| `actual_close`         | Filled in once the target bar settles                                |
| `won`                  | 0/1, null until scored                                               |
| `market_regime`        | Classifier's read at decision time                                   |
| `order_status`         | `pending_placement`, `filled`, `unfilled`, or a `skipped_*` reason   |
| `order_placed_at_ms`   | Simulated order-placement wall-clock                                 |
| `order_observed_price` | Predicted-side token price read at simulated placement               |
| `order_limit_price`    | Simulated limit-buy price                                            |
| `order_confidence`     | Average effective winning-voter confidence used for the EV gate      |
| `order_filled_at_ms`   | When the simulated order first became fillable                       |
| `order_fill_price`     | Simulated fill price                                                 |
| `order_expires_at_ms`  | Target market close; placed orders still unfilled here expire        |

Abstain decisions are **not** written. Pending rows have
`actual_close = null` and `won = null`; the loop fills them in when
the target bar closes. Older rows created before order simulation are
marked `order_status = 'untracked'`.

## CLI output

The CLI streams one line per event:

```
13:21:05 hydrated btc bars=150
13:21:05 hydrated eth bars=150
...
13:21:05 loaded committee roster: 8 buckets, 80 candidates (selected_at=2026-05-11 13:18)
13:21:05 connected
13:24:55 UP     eth   target=13:25 synth=2335.23 regime=low_vol_ranging roster=10 u=7 d=0 a=3
13:24:55 abstain btc   target=13:25 synth=80876.38 regime=low_vol_trending roster=10 u=0 d=0 a=10
...
13:25:01 WIN  eth   bar=13:20 pred=u open=2329.42 close=2330.27
```

Five event kinds: `hydrated`, `roster`, `connected` / `disconnected`,
`decision`, `outcome`, `error`. See
[`bin/dry/run.ts`](../src/bin/dry/run.ts) for the styling
contract.

## Failure modes

- **Stream drops** — auto-reconnect with backoff. Decisions miss
  during the gap; in-flight bar accumulators recover on the next
  tick. Logged as `disconnected` + `connected`.
- **Stale committee roster** — the CLI startup line shows
  `selected_at`. If that's days old and the backtest has since
  expanded, the live committee is voting with an outdated
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
- [`src/lib/dryRun/orderSimulation.ts`](../src/lib/dryRun/orderSimulation.ts) —
  post-open dry-run order placement + fill simulation.
- [`src/lib/trading/vendor/polymarket/marketDiscoveryCache.ts`](../src/lib/trading/vendor/polymarket/marketDiscoveryCache.ts) —
  shared current/next-window market discovery cache.
- [`src/lib/dryRun/loadRecentBars.ts`](../src/lib/dryRun/loadRecentBars.ts) —
  hydration query.
- [`src/lib/dryRun/types.ts`](../src/lib/dryRun/types.ts) — internal
  shapes.
- [`src/lib/dryRun/dashboard/`](../src/lib/dryRun/dashboard/) —
  payload loader + HTML renderer.
- [`src/bin/dry/run.ts`](../src/bin/dry/run.ts) — the CLI.
- [`src/lib/livePrices/pyth/streamPythHermes.ts`](../src/lib/livePrices/pyth/streamPythHermes.ts) —
  Pyth SSE wrapper with reconnect + watchdog.
