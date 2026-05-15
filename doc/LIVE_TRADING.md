# Live Trading

`bun alea trading:run` is the real-money version of the OpenAI chart
decision runner. It uses the same Pyth chart rendering, OpenAI
prediction, and order-placement policy as dry-run. The difference is
execution: returned green/red decisions place real Polymarket orders.

Run it:

```sh
bun alea trading:run
```

By default it trades the full BTC/ETH/SOL/XRP/DOGE `5m` + `15m` market set:
`5m/btc`, `15m/btc`, `5m/eth`, `15m/eth`, `5m/sol`, `15m/sol`, `5m/xrp`,
`15m/xrp`, `5m/doge`, and `15m/doge`. Use
`--assets` and/or `--periods` to override the grid:

```sh
bun alea trading:run --periods 15m
bun alea trading:run --assets eth --periods 5m,15m
```

Required environment:

- `OPENAI_API_KEY`
- `POLYMARKET_PRIVATE_KEY`
- `POLYMARKET_FUNDER_ADDRESS`
- `DATABASE_URL` if not using the local default
- `AXIOM_API_KEY` to stream live telemetry to Axiom
- `AXIOM_QUERY_API_KEY` optional read-scoped Axiom token for terminal
  telemetry queries; falls back to `AXIOM_API_KEY`
- `AXIOM_DATASET` optional, defaults to `alea-live`
- `AXIOM_DOMAIN` optional, defaults to `https://api.axiom.co`

The Axiom dataset must exist before the trader starts. `AXIOM_API_KEY`
needs ingest permission for that dataset. Terminal query commands need
read/query permission, either on the same token or via
`AXIOM_QUERY_API_KEY`.

Run `bun alea polymarket:auth-check` before launching on a fresh host
or after rotating credentials.

## Telemetry

When `AXIOM_API_KEY` is present, `trading:run` streams structured
live telemetry to Axiom and also writes every event to a local NDJSON
spool under `tmp/telemetry/live/`. Telemetry is best-effort and never
blocks order placement; if Axiom is unavailable, the local spool is
the fallback artifact.

The live event stream captures runner hydration, predictor config, each
OpenAI chart decision, market stream state, order scheduling, every live
post attempt, and final order placement/rejection/skips. Order-attempt
events include BBO, spread, quote age, token/market refs, post latency,
failure kind/status, and summarized book depth around the posted
limit.

Terminal query helpers:

```sh
bun alea telemetry:orders --since now-24h
bun alea telemetry:rejects --since now-24h --by asset,period,failureKind
bun alea telemetry:book-depth --since now-6h --by asset,period,prediction
bun alea telemetry:query --apl "['alea-live'] | limit 10"
```

## Timing

For each configured asset/period market:

1. The runner hydrates recent Pyth bars into an in-memory buffer.
   Pyth is the canonical timeline and chart source for the OpenAI
   decision path.
2. Starting `LIVE_TRADING_MARKET_DISCOVERY_LEAD_MS = 15m` before the
   next market opens, it resolves the next Polymarket slug and
   subscribes to both UP and DOWN token books. Polymarket currently
   exposes these books much earlier, but 15 minutes keeps the hot path
   settled and leaves room to move decision timing earlier without a
   market-discovery race.
3. At the configured period lead (`5m` at T-2m, `15m` at T-3m), it
   refreshes recent Pyth candles for every due asset/period, fetches
   the latest Pyth price, synthesizes the active Pyth candle, renders
   the chart with the price line and top OHLC block hidden, and asks
   OpenAI for a Zod-validated `{ direction, reasoning }` response.
   Pyth failures or stale latest Pyth prices skip the decision.
4. Live placement starts immediately after the returned direction.
   Public Polymarket checks on 2026-05-13 showed next BTC `5m` and
   `15m` crypto up/down markets were already `active`, `accepting`,
   and serving books before their window opened. The live path treats
   that as permission to rest the maker order before the candle starts.
5. If Polymarket rejects the order as too early / not ready, returns
   `404`/`425`/`429`/`5xx`, or the request fails transiently, the
   runner retries aggressively through the target boundary and for
   `LIVE_TRADING_ORDER_RETRY_AFTER_OPEN_MS = 2500ms` after open.

## Order Policy

Live trading only places predicted-side maker buys:

- UP decision: buy the UP token.
- DOWN decision: buy the DOWN token.
- Limit price: one tick below the predicted-side best ask.
- No predicted-side ask yet: one tick below 50c.
- Order type: `GTD` post-only.
- Expiration: target market close.
- Notional: `STAKE_USD`.
- Price band: `50c +/- LIVE_TRADING_ORDER_PRICE_WINDOW_CENTS`, today
  `+/- 3c`.

If placement is rejected or the book moves, the runner recomputes from
the latest known book and retries up to
`LIVE_TRADING_MAX_ORDER_ATTEMPTS = 800`, as long as the recomputed
order remains inside the price band. A post-only cross rejection
ratchets the next attempt down by one tick
even if no fresher WebSocket quote has arrived. There is no retry after
price-band failure.

Rate-limit and transient venue failures use adaptive retry sleeps
instead of the normal 50ms placement retry delay. This avoids turning
a Polymarket 429 or short 5xx incident into a request storm across
all live asset/period loops.

The live path is still intentionally maker-only. Switching to FAK/FOK
or non-post-only taker entry would raise fill probability, but it is a
different EV and fee decision than the current near-50c maker strategy.

## Persistence

Live trading does not write local trade/fill rows. Once Polymarket
confirms order creation, Alea is done with that order. Polymarket is
the source of truth for open orders, fills, positions, and PnL. The
local DB is used for candle history only.

SIGINT/SIGTERM stops the scheduler, clears not-yet-started scheduled
orders, closes the market-data WebSocket, and flushes telemetry. The
Polymarket SDK does not expose an abort signal for an already in-flight
`createAndPostOrder` call, so a request that was already sent may still
complete at the venue during shutdown.

## Files

- [`src/bin/trading/run.ts`](../src/bin/trading/run.ts) — CLI glue.
- [`src/lib/trading/runLiveTrading.ts`](../src/lib/trading/runLiveTrading.ts) —
  live scheduler and shared OpenAI chart decision path.
- [`src/lib/trading/liveOrderExecution.ts`](../src/lib/trading/liveOrderExecution.ts) —
  market pre-subscription, pre-open order posting, and retry handling.
- [`src/lib/trading/marketPriceState.ts`](../src/lib/trading/marketPriceState.ts) —
  shared Polymarket book/BBO state and maker-pricing logic.
