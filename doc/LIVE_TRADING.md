# Live Trading

`bun alea trading:run` is the real-money version of the committee
runner. It uses the same source-aware candle refresh, regime
classification, committee roster, one-vote-per-filter aggregation,
and confidence gate as dry-run. The difference is execution:
actionable decisions place real Polymarket orders.

Run it:

```sh
bun alea trading:run
```

By default it trades all supported assets across both `5m` and `15m`.
Use `--periods` to restrict the grid:

```sh
bun alea trading:run --periods 5m
```

Required environment:

- `POLYMARKET_PRIVATE_KEY`
- `POLYMARKET_FUNDER_ADDRESS`
- `DATABASE_URL` if not using the local default

Run `bun alea polymarket:auth-check` before launching on a fresh host
or after rotating credentials.

## Timing

For each asset/period:

1. The runner hydrates recent Pyth and Coinbase spot bars into
   parallel in-memory buffers. Pyth is the canonical timeline;
   Coinbase supplies volume for filters that declare
   `barSource: "coinbase"`.
2. Starting `LIVE_TRADING_MARKET_DISCOVERY_LEAD_MS = 5m` before the
   next market opens, it resolves the next Polymarket slug and
   subscribes to both UP and DOWN token books. Polymarket currently
   exposes these books much earlier, but 5 minutes keeps the hot path
   settled without carrying a day of subscriptions.
3. At `T-30s`, it refreshes recent Pyth and Coinbase spot candles for
   every due asset/period concurrently, fetches the latest Pyth price,
   synthesizes the active Pyth candle, aligns Coinbase bars to the
   Pyth timestamps, and asks the committee for a decision. Coinbase
   failures are soft; Pyth failures or stale latest Pyth prices skip
   the decision.
4. If the decision is actionable, live placement starts immediately.
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
- Confidence gate: average winning-voter selected win rate must be at
  least the limit price.

If placement is rejected or the book moves, the runner recomputes from
the latest known book and retries up to
`LIVE_TRADING_MAX_ORDER_ATTEMPTS = 800`, as long as the recomputed
order remains inside the price band and passes the confidence gate. A
post-only cross rejection ratchets the next attempt down by one tick
even if no fresher WebSocket quote has arrived. There is no retry after
price-band or confidence failure.

The live path is still intentionally maker-only. Switching to FAK/FOK
or non-post-only taker entry would raise fill probability, but it is a
different EV and fee decision than the current near-50c maker strategy.

## Persistence

Live trading does not write local trade/fill rows. Once Polymarket
confirms order creation, Alea is done with that order. Polymarket is
the source of truth for open orders, fills, positions, and PnL. The
local DB is used for candle history and committee selection only.

## Files

- [`src/bin/trading/run.ts`](../src/bin/trading/run.ts) — CLI glue.
- [`src/lib/trading/runLiveTrading.ts`](../src/lib/trading/runLiveTrading.ts) —
  live scheduler and shared committee decision path.
- [`src/lib/trading/liveOrderExecution.ts`](../src/lib/trading/liveOrderExecution.ts) —
  market pre-subscription, pre-open order posting, and retry handling.
- [`src/lib/trading/marketPriceState.ts`](../src/lib/trading/marketPriceState.ts) —
  shared Polymarket book/BBO state and maker-pricing logic.
