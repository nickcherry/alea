# Polymarket Integration

This is the source map for the Polymarket behavior Alea depends on. When the
live implementation has to rely on an observed payload shape that differs from
the official docs, record the shape and observation date here before encoding
the assumption in code.

## Endpoint Constants

The canonical URL set lives in
[`src/constants/polymarket.ts`](../src/constants/polymarket.ts):

- CLOB REST: `https://clob.polymarket.com`
- Gamma API: `https://gamma-api.polymarket.com`
- CLOB market WebSocket: `wss://ws-subscriptions-clob.polymarket.com/ws/market`
- CLOB user WebSocket: `wss://ws-subscriptions-clob.polymarket.com/ws/user`
- Real Time Data Socket: `wss://ws-live-data.polymarket.com`

## Official Docs

- [Developer endpoints](https://docs.polymarket.com/developers) — base REST,
  Data API, WebSocket, and RTDS endpoints.
- [Markets and events](https://docs.polymarket.com/concepts/markets-events) —
  slug-based Gamma event discovery and market identifiers.
- [RTDS WebSocket](https://docs.polymarket.com/market-data/websocket/rtds) —
  real-time Chainlink crypto price stream used as the latency/reliability
  baseline.
- [CLOB order and trade methods](https://docs.polymarket.com/developers/CLOB/orders/cancel-orders) —
  cancel response shape, open orders, and authenticated trade history.
- [CLOB V2 migration](https://docs.polymarket.com/v2-migration) —
  current production order format, V2 signatures, and removed V1 order fields.
- [CLOB user channel](https://docs.polymarket.com/market-data/websocket/user-channel) —
  authenticated fill/order updates scoped by condition IDs.
- [CLOB market channel](https://docs.polymarket.com/market-data/websocket/market-channel) —
  public book, price-change, trade-price, tick-size, and resolution events
  scoped by token IDs.
- [WebSocket quickstart](https://docs.polymarket.com/quickstart/websocket/WSS-Quickstart) —
  channel list and subscription shapes.

## Current Assumptions

- Crypto event slugs use
  `<asset>-updown-<5m|15m>-<windowStartUnixSeconds>`. `discoverPolymarketMarket`
  reads `GET /events?slug=<slug>` and expects a binary `Up` / `Down` market
  with two CLOB token IDs.
- `polymarket:price-sample` records one row per completed live
  `(asset, timeframe, window_start)` in `polymarket_price_samples`. The row's
  `samples` JSONB is a compact array of `[offset_ms, up_price_bps, quality]`
  tuples; `up_price_bps / 10000` recovers the 0..1 UP contract price and
  `window_start_ts_ms + offset_ms` recovers the sample timestamp. The purpose
  is to calibrate expectations for how long 50c prices remain available; the
  `/price-paths/` dashboard renders the distribution heatmap, 50c band-decay
  chart, and 50c-crossings chart + marker table from these rows.
- The TypeScript integration uses `@polymarket/clob-client-v2`. Live order
  creation must stay on the V2 signed-order shape: no submitted order nonce and
  no embedded `feeRateBps`; fee fields are read from venue market metadata and
  historical trades.
- RTDS `crypto_prices_chainlink` frames provide the Chainlink-derived crypto
  reference prices. The latency experiment filters that topic to `btc/usd`;
  the reliability experiment maps every requested `<asset>/usd` symbol.
- CLOB `/book?token_id=<tokenId>` is public and returns bid/ask level arrays
  with string prices and sizes. Alea scans levels and picks best bid/ask
  rather than trusting array order. Gamma market discovery carries token IDs,
  condition IDs, tick size, and sometimes `neg_risk`; the SDK can fetch missing
  per-token metadata when signing.
- `marketDiscoveryCache` centralizes current/next-window Gamma slug discovery
  and deduplicates concurrent lookups. Dry-run and live trading share it so
  order placement has already resolved condition/token IDs before the target
  window opens.
- The public market WebSocket subscription sends
  `{ type: "market", assets_ids: [...tokenIds], custom_feature_enabled: true }`.
  Dry-run and live trading consume `book`/`best_bid_ask` for executable quote
  state and treat `last_trade_price` as non-fill evidence.
  `tick_size_change` remains operator-visible venue metadata, and
  `market_resolved` is the official-first settlement event for paths that need
  venue resolution. REST resolution remains the fallback if the websocket event
  is missed.
- Current live order placement is maker-only. On 2026-05-13, public probes of
  current/next BTC crypto windows found Gamma returning future `5m` and `15m`
  events with `active=true`, `accepting=true`, token IDs, and CLOB books out to
  roughly 23h48m ahead; the next aligned windows after that had no event. A
  live canary posted a post-only BTC `5m` BUY at 1c about 6m52s before the
  target window opened, received `success=true` / `status=live`, then canceled
  cleanly with zero open orders left. Live trading therefore signs and posts
  `createAndPostOrder(..., OrderType.GTD, postOnly=true)` immediately after the
  period-specific pre-open OpenAI chart decision (`5m` at T-2m, `15m` at T-3m)
  instead of waiting for the boundary. The actionable side is the inverse of
  OpenAI's chart color, so green buys DOWN and red buys UP. It buys that
  predicted-side token one tick below the best ask, or one tick below 50c if no
  predicted-side ask has arrived, expiring at that market's close.
- Pre-market books are not empty placeholders. In the same 2026-05-13 snapshot,
  far-ahead markets clustered near 50c with 1c-4c spreads; within the last
  couple minutes before open, mids had already moved with the underlying, e.g.
  next-window `5m` UP mids across BTC/ETH/SOL/XRP/DOGE ranged roughly
  50.5c-55.5c and next-window `15m` ranged roughly 50.0c-56.5c, with DOGE 15m
  especially wide.
- If Polymarket starts rejecting pre-open orders, the relevant order errors are
  retryable rather than fatal: market-not-ready, `404`/`not found`, `425` too
  early, `429`, `5xx`, and transient network failures. A post-only cross
  rejection is also retryable, but the next attempt is capped one tick below the
  rejected limit so the bot can recover without waiting for a fresh WebSocket
  book frame. Balance/allowance, auth/signature, banned/closed-only, malformed
  payload, tick-size, and minimum-size errors are terminal operator problems.
- Live trading does not consume the user WebSocket for fill tracking. Once the
  CLOB confirms order creation, Polymarket remains the source of truth for open
  orders, fills, positions, and PnL.
- CLOB trade fees are normalized from the venue's fee curve:
  `shares * (fee_rate_bps / 10000) * price * (1 - price)`, rounded to five
  decimal places. Trades reported as `trader_side=MAKER` are treated as
  zero-fee, matching Polymarket's current fee model.
