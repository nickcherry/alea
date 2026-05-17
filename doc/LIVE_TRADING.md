# Live Trading

`bun alea trading:run` is the real-money version of the filter decision
runner. It uses the same Pyth candle state, period-specific candidate registry,
pre-open timing, and order-placement policy as dry-run. The difference is that
it places real Polymarket maker orders.

## Required Environment

- `POLYMARKET_PRIVATE_KEY`
- `POLYMARKET_FUNDER_ADDRESS`
- `AXIOM_API_KEY` to stream live telemetry to Axiom
- `AXIOM_DATASET` optional, defaults to `alea-live`
- `AXIOM_DOMAIN` optional, defaults to `https://api.axiom.co`

## Flow

1. Hydrate recent Pyth spot candles for the selected `5m` / `15m` markets.
2. Pre-discover and pre-subscribe upcoming Polymarket markets.
3. At the configured lead time, refresh candles, synthesize the active Pyth
   candle, and evaluate the candidates registered for that candle period.
4. If up votes beat down votes, schedule an UP maker order. If down votes beat
   up votes, schedule a DOWN maker order. Ties or all-neutral votes do not
   trade.
5. Order execution remains post-only maker with GTD expiry and the configured
   price-window checks.

The runner continues after an individual decision failure or timeout so one
wedged market cannot block later boundaries.

## Telemetry

Live telemetry streams decision summaries, market stream state, order
scheduling, order attempts, order results, and sanitized venue failures to
Axiom when configured. It also writes a local NDJSON spool under
`tmp/telemetry/live/`.

Useful commands:

```sh
bun alea telemetry:orders --since now-24h --by asset,period,orderStatus
bun alea telemetry:rejects --since now-24h --by asset,period,failureKind
bun alea telemetry:query --apl "['alea-live'] | limit 10"
```

## Key Code

- `src/lib/trading/runLiveTrading.ts` — live scheduler and shared filter
  decision path.
- `src/lib/trading/liveOrderExecution.ts` — Polymarket market discovery,
  subscription, maker-order scheduling, and retry handling.
- `src/lib/filters/registry.ts` — active candidate registry.
