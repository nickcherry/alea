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
2. Starting `LIVE_TRADING_MARKET_DISCOVERY_LEAD_MS = 60s` before the
   next market opens, it resolves the next Polymarket slug and
   subscribes to both UP and DOWN token books.
3. At `T-5s`, it refreshes recent Pyth and Coinbase spot candles,
   fetches the latest Pyth price, synthesizes the active Pyth candle,
   aligns Coinbase bars to the Pyth timestamps, and asks the
   committee for a decision. Coinbase failures are soft; Pyth failures
   or stale latest Pyth prices skip the decision.
4. If the decision is actionable, the order is scheduled for the
   exact market-open timestamp. There is no artificial live-trading
   delay; the dry-run `100ms` delay exists only to simulate expected
   live latency.
5. At market open, the runner uses the freshest book state and tries
   to submit immediately.

## Order Policy

Live trading only places predicted-side maker buys:

- UP decision: buy the UP token.
- DOWN decision: buy the DOWN token.
- Limit price: one tick below the predicted-side best ask.
- Order type: `GTD` post-only.
- Expiration: target market close.
- Notional: `STAKE_USD`.
- Price band: `50c +/- LIVE_TRADING_ORDER_PRICE_WINDOW_CENTS`, today
  `+/- 3c`.
- Confidence gate: average winning-voter selected win rate must be at
  least the limit price.

If placement is rejected or the book moves, the runner recomputes from
the latest book and retries up to
`LIVE_TRADING_MAX_ORDER_ATTEMPTS = 10`, as long as the recomputed
order remains inside the price band and passes the confidence gate.
There is no retry after price-band or confidence failure.

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
  market pre-subscription, post-open order retries, and order posting.
- [`src/lib/trading/marketPriceState.ts`](../src/lib/trading/marketPriceState.ts) —
  shared Polymarket book/BBO state and maker-pricing logic.
