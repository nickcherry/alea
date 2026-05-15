# Dry Run

The dry-run loop is the rehearsal path for live trading: a long-running
process that keeps recent Pyth candles in memory, refreshes them just
before each market boundary, synthesizes the active Pyth candle from
the latest Pyth price, renders the visible chart, asks OpenAI to
predict the next candle, and persists every returned green/red
decision to `dry_run_decisions`. No real orders are placed. The loop
also simulates whether a configured pre-open Polymarket order would
have been eligible, placed, filled, or left unfilled.

Run it:

```sh
bun alea dry:run
```

By default the runner uses the full BTC/ETH/SOL/XRP/DOGE `5m` + `15m` market set:
`5m/btc`, `15m/btc`, `5m/eth`, `15m/eth`, `5m/sol`, `15m/sol`, `5m/xrp`,
`15m/xrp`, `5m/doge`, and `15m/doge`.
Override either axis with comma-separated lists:

```sh
bun alea dry:run --periods 15m
bun alea dry:run --assets eth --periods 5m,15m
```

Stays running until SIGINT / SIGTERM. The OpenAI chart-decision logic
is identical to what live trading uses.

## What it does, per asset/period

For each configured asset/period market in the default set or override
grid:

1. **Hydrate** — load enough closed Pyth bars for the chart window:
   1,152 bars for `5m` charts (4 days) and 960 bars for `15m` charts
   (10 days).
   Pyth is the canonical price/settlement-proxy series and the only
   chart source used by the OpenAI decision path.
2. **Refresh** — before each configured period boundary, fetch recent
   Pyth candles for that asset/period and upsert them into the
   in-memory buffer by candle open time. Pyth refresh failures skip
   the decision.
3. **Synthesize + predict** — fetch the latest one-shot Pyth price,
   combine it with the active Pyth candle when available, and build a
   synthetic active candle for the about-to-finalize bar. Render the
   visible Pyth chart with the price line and top OHLC block hidden
   while keeping the default indicator bundle visible. Send that image
   to OpenAI, and map `green` to UP and `red` to DOWN. Persist every
   returned green/red decision.
4. **Simulate order** — immediately after an OpenAI decision, read the live UP/DOWN book/BBO
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

1. Startup hydrates Pyth closed bars into a rolling buffer.
2. At decision time, [`candleState.ts`](../src/lib/tradeDecision/candleState.ts)
   fetches recent Pyth Benchmark candles for the specific
   asset/period and upserts them into memory with no duplicate open
   times. This decision-time fetch uses a short timeout and no
   backoff retries; slow backfills should not hold the trading loop
   through the boundary.
3. It then fetches a one-shot latest Pyth price via
   [`fetchLatestPythPrices`](../src/lib/livePrices/pyth/fetchLatestPythPrices.ts).
   If that price is older than
   `TRADE_DECISION_MAX_PRICE_AGE_MS`, the decision is skipped instead
   of trading stale state.
4. If Pyth has already returned the active partial candle, its
   open/high/low are used and the latest price becomes the synthetic
   close. If not, the prior closed candle's close is used as the
   fallback open and the latest price defines the active bar's close.

The remaining websocket in dry-run is the Polymarket market-data
stream used by order simulation. That stream is about fillability and
book state, not candle construction.

## OpenAI chart evaluation

At the configured lead for each boundary (`5m` at T-2m, `15m` at T-3m),
for each configured asset/period market:

1. Build the decision bar window from closed Pyth history plus the
   synthetic active candle.
2. Render the chart with [`renderMarketChartImage`](../src/lib/candles/chart/renderMarketChartImage.ts).
3. Ask OpenAI through [`predictMarketChart`](../src/lib/candles/chart/predictMarketChart.ts).
4. Validate the response with Zod as `{ direction, reasoning }`.
5. Map `direction=green` to `prediction='u'` and `direction=red` to
   `prediction='d'`.
6. Persist the decision and simulate an order.

Each OpenAI chart attempt appends one JSONL row to
`OPENAI_CHART_PROMPT_LOG_PATH`, defaulting to
`tmp/openai-chart-prompts.jsonl`. The row includes the model,
instructions, prompt text, rendered chart image path, and either the
validated response or the error. Dry-run/live chart images are kept
under `tmp/openai-chart-decisions/` so the logged image path remains
inspectable after the request finishes.

## Order simulation

Dry-run order configuration lives in
[`src/constants/dryRun.ts`](../src/constants/dryRun.ts).

| Constant                                 |   Default | Meaning                                                                       |
| ---------------------------------------- | --------: | ----------------------------------------------------------------------------- |
| `DRY_RUN_ORDER_PLACEMENT_DELAY_MS`       |       0ms | Wait after the OpenAI decision before simulating entry                        |
| `DRY_RUN_ORDER_PRICE_WINDOW_CENTS`       |        3c | Only consider predicted-side prices within `50c ± window`                     |
| `DRY_RUN_ORDER_DEFAULT_TICK_SIZE`        |        1c | Fallback tick when market metadata has not supplied one yet                   |
| `DRY_RUN_ORDER_NO_QUOTE_REFERENCE_PRICE` |   50c ref | Reference price used to bid one tick lower when no ask has arrived            |
| `DRY_RUN_ORDER_MAX_QUOTE_AGE_MS`         | unbounded | Use latest known quote; missing placement quotes fall back one tick below 50c |
| `DRY_RUN_MARKET_DISCOVERY_LEAD_MS`       |  900000ms | How early to pre-discover current and next Polymarket markets                 |

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

OpenAI chart decisions no longer carry a model-provided confidence
score. The legacy `order_confidence` column is left null for new
OpenAI rows.

Market discovery is centralized in
[`src/lib/trading/vendor/polymarket/marketDiscoveryCache.ts`](../src/lib/trading/vendor/polymarket/marketDiscoveryCache.ts).
Dry-run and live trading both use it, so both paths pre-discover the
exact market window before trying to stream or trade it.

## Persistence: `dry_run_decisions`

Append-only. One row per OpenAI chart decision. Schema:
[`202605120100_create_dry_run_decisions`](../src/lib/db/migrations/202605120100_create_dry_run_decisions.ts)
plus later dry-run/order migrations.

| Column                  | Meaning                                                                                       |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| `id`                    | bigserial PK                                                                                  |
| `ts_ms`                 | Open-time of the target bar (the bar being predicted)                                         |
| `decided_at_ms`         | Wall-clock when the prediction was made                                                       |
| `asset`, `period`       | Self-explanatory                                                                              |
| `prediction`            | `'u'` or `'d'`                                                                                |
| `synth_open`            | Pyth price snapshotted at decision lead — used as the bar's synthetic open                    |
| `actual_open`           | Filled with the resolved target-bar open once scored; null for pending or legacy rows         |
| `decision_audit`        | JSON OpenAI audit object including `{source, model, direction, reasoning, up, down, abstain}` |
| `actual_close`          | Filled in once the target bar settles                                                         |
| `won`                   | 0/1, null until scored                                                                        |
| `decision_duration_ms`  | Chart render + OpenAI decision time before persistence                                        |
| `order_status`          | `pending_placement`, `filled`, `unfilled`, or a `skipped_*` reason                            |
| `order_placed_at_ms`    | Simulated order-placement wall-clock                                                          |
| `order_observed_price`  | Predicted-side token price read at simulated placement                                        |
| `order_limit_price`     | Simulated limit-buy price                                                                     |
| `order_confidence`      | Legacy confidence column; null for current OpenAI chart decisions                             |
| `order_filled_at_ms`    | When the simulated order first became fillable                                                |
| `order_fill_price`      | Simulated fill price                                                                          |
| `order_fill_latency_ms` | Milliseconds from simulated placement to first fillability evidence                           |
| `order_expires_at_ms`   | Target market close; placed orders still unfilled here expire                                 |
| `order_market_ref`      | Polymarket condition id for the target window used by order simulation                        |
| `order_up_token_ref`    | Polymarket UP token id for that target window                                                 |
| `order_down_token_ref`  | Polymarket DOWN token id for that target window                                               |

Pending rows have `actual_close = null` and `won = null`; the loop fills
them in when the target bar closes. Older rows created before order
simulation are marked `order_status = 'untracked'`.

`dry_run_decision_attempts` is the timing table for every scheduled
OpenAI chart evaluation. It records target window, asset, period,
decision duration, OpenAI model, direction, reasoning, and the linked
`dry_run_decisions.id`. Confidence columns are nullable because current
OpenAI chart predictions return direction and reasoning, not a separate
confidence scalar.

## CLI output

The CLI streams one line per event:

```
13:21:05 hydrated 5m/btc bars=1152
13:21:05 hydrated 15m/btc bars=960
...
13:21:05 predictor openai_chart
13:21:05 ready
13:24:55 UP     5m/eth   target=13:25 synth=2335.23 source=openai model=gpt-5.4 reason=...
13:24:55 DOWN   15m/btc  target=13:30 synth=80876.38 source=openai model=gpt-5.4 reason=...
...
13:25:01 WIN  5m/eth   bar=13:20 pred=u open=2329.42 close=2330.27
```

Event kinds: `hydrated`, `predictor`, `ready`, `decision`, `order`,
`outcome`, `error`. See
[`bin/dry/run.ts`](../src/bin/dry/run.ts) for the styling
contract.

When `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are set, each
`outcome` event also sends a Telegram message with the market result,
prediction, order fill status, and session right/wrong plus
filled/unfilled/open/skipped counts.

## Failure modes

- **Pyth refresh/latest failure** — the decision is skipped if recent
  candles cannot be fetched, the latest price is missing, or the
  latest price is stale. Logged as `error`; the next boundary retries
  with fresh fetches.
- **OpenAI auth/scope failure** — the process fails fast at startup
  when `OPENAI_API_KEY` is missing. Restricted keys must have
  Responses API write scope.

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
