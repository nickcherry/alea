# Trading Domain

The trading domain is the live, money-touching counterpart to the
[training domain](./TRAINING_DOMAIN.md). Training is the offline
playground where we explore filters, score candidates, and produce
dashboards; trading is the curated, version-controlled subset of that
work that the bot actually runs against real prediction markets.

This doc is the operator-facing surface for live trading: the model,
the architecture, the API touchpoints we depend on, and the failure
modes you'll see in the wild.

## Contents

- [Model](#model)
- [Architecture](#architecture)
- [Vendor abstraction](#vendor-abstraction)
- [Lifecycle of a 5-minute window](#lifecycle-of-a-5-minute-window)
- [API touchpoints](#api-touchpoints)
- [Failure modes and recovery](#failure-modes-and-recovery)
- [Telegram messages](#telegram-messages)
- [Commands](#commands)
- [Files](#files)

## Model

The bot trades the venue's 5-minute crypto up/down markets — one per
5m UTC boundary, per asset (`btc`, `eth`, `sol`, `xrp`, `doge`).
Settlement: did the underlying close above or below its open price
at the 5m boundary, per the venue's resolution oracle (Polymarket
uses Chainlink BTC/USD and friends).

**Measurement vs. settlement.** The model conditions on Binance USDT-
margined perpetual futures, not the resolution oracle: Binance is denser
and arrives earlier, while Polymarket's Chainlink-derived RTDS baseline is
slower (~1 Hz and visibly delayed during sharp moves). The relative move
tracks the oracle closely, and the trade-off (an occasional
Binance↔Chainlink directional disagreement) is dwarfed by the latency win
on entry. The wallet's USDC balance — not our internal PnL accounting —
remains the on-chain source of truth.

Each in-window snapshot is classified by:

- `currentSide` — `up` if `currentPrice ≥ line`, else `down`.
- `distanceBp` — `floor(|currentPrice − line| / line × 10000)`.
- `remaining` — minutes left in the window, floored to one of
  `{1, 2, 3, 4}` per the training pipeline's snapshot convention
  (snapshots happen at +1m, +2m, +3m, +4m with `remaining = 5 − N`).
- `regimesByAlgoId` — for every algo in `LIVE_TRADING_REGIME_ALGOS`
  (`vol_only_3`, `vol_quartiles_4`, `trend_x_vol_6`), the regime label
  the snapshot's features classify into. Algos whose required features
  haven't seeded yet (warmup) drop out by returning `null`.

The probability table maps `(asset, algoId, regime, remaining,
distanceBp)` → `P(currentSide settles winning)`, derived empirically
from the training data. Only **leading** regimes are persisted —
those whose hold-rate beats the unconditional baseline by at least
`LEADING_REGIME_MIN_LEAD_PP` (1.0pp); lagging regimes are excluded
entirely. Per-cell sample floor is `REGIME_CELL_MIN_SAMPLES` (400);
buckets thinner than that are dropped pre-aggregation. See
[REGIMES.md](./REGIMES.md) for the active algo set and the
auto-promotion mechanics.

`evaluateDecision` is the single-table **multi-algo greedy** primitive:

1. Classify the snapshot under every algo in the registry.
2. For every (algo, regime) pair the snapshot matches AND that has a
   populated bucket at `(remaining, distanceBp)`, compute the per-side
   edge against the resting Polymarket bid.
3. Pick the (lookup, side) tuple with the maximum edge across all
   matches. Trade if `edge ≥ MIN_EDGE` (0.05) AND
   `ourProbability ≥ MIN_MODEL_PROBABILITY` (0.55); otherwise skip
   with a typed reason (`thin-edge`, `low-confidence`, `no-bucket`,
   `no-bid`, `warmup`, `too-close-to-line`, `out-of-window`).

The live and dry-run operator commands wrap that primitive with the current
research challenger:

- load four committed probability tables (`binance/perp`, `binance/spot`,
  `coinbase/perp`, `coinbase/spot`);
- require all four tables to produce a trade on the same side;
- trade only BTC/ETH/SOL;
- require chosen-side spread `<= 0.07`, chosen best ask `<= 0.75`, and the
  underlying price already on the chosen side of the line;
- execute as taker, with dry-run using the same real-depth book walk live uses
  to cap its FAK order.

The live runner keeps a single rolling buffer of recently-closed 5m
bars per asset (`RegimeTrackers`, capped at 70 bars). Per-decision the
buffer is folded into a `RegimeClassifierInput` containing every
feature the algos read (EMA-20/50, ATR-3/14/50, RSI-14, prev-bar
direction). Same `build5mLookback` runs over the live buffer that the
training-side snapshot pipeline runs over historical candles — so any
algo can read whatever features its `classify` needs without per-input
plumbing. Bars are hydrated at boot from a REST `klines?interval=5m`
fetch (most recent `REGIME_TRACKER_BOOTSTRAP_BARS` = 70) and rolled
forward by the websocket `kline_5m` close stream; if a close is
missed, the next-window REST fallback re-hydrates the exact prior bar
before allowing a decision.

## Architecture

The runner is vendor-agnostic, and its underlying price feed is
abstracted behind `LivePriceSource`. Binance perp remains the default
source, but live and dry trading receive it by injection rather than
importing Binance directly. Anything Polymarket-specific is isolated
behind the `Vendor` interface; the orchestrator never imports
Polymarket directly.

```
                  ┌──────────────────────┐
                  │  LivePriceSource     │  ticks + closed 5m bars
                  │  (Binance default)   │
                  └─────────┬────────────┘
                            │ ticks + closes
              ┌─────────────▼─────────────┐
              │   src/lib/trading/live/   │
              │   ─────────────────────   │
              │   runLive (orchestrator)  │
              │   placement.ts            │
              │   marketHydration.ts      │
              │   wrapUpWindow.ts         │
              │   settleRecord.ts         │
              │   applyFill.ts            │
              │   cancelResidualOrders.ts │
              │   lifetimePnlBootstrap.ts │
              └─────┬──────────────┬──────┘
                    │              │
   discoverMarket   │              │  fetchBook / prepareMakerLimitBuy
   hydrateMarket    │              │  placeMakerLimitBuy / placeTakerMarketBuy
   streamMarketData │              │  streamUserFills / resolveOutcome
   scanLifetimePnl  │              │  …
                    ▼              ▼
        ┌──────────────────────────────────┐
        │  Vendor (interface)              │
        │  src/lib/trading/vendor/types.ts │
        └─────────┬────────────────────────┘
                  │
         ┌────────┴────────┬────────────┬─────────────┐
         ▼                 ▼            ▼             ▼
  Polymarket impl     (Kalshi)     (Hyperliquid)   (paper-trade?)
  src/lib/trading/    future       future          future
  vendor/polymarket/
```

The orchestrator (`runLive.ts`) only does three things:

1. **Boot.** Hydrate lifetime PnL from the checkpoint, then reconcile it
   against vendor trade history. Hydrate the per-asset rolling 5m bar
   buffers (`RegimeTrackers`) over REST. Open the configured live price
   source. Open the vendor's user fill stream.
2. **Tick.** Every 250 ms, detect window rollover, capture lines,
   evaluate decisions, fire `placeWithRetry` for empty slots that
   pass the edge filter.
3. **Shutdown.** Cancel pending timers, close streams.

Everything else lives in single-responsibility modules under `live/`.

## Vendor abstraction

The complete vendor contract lives in
[src/lib/trading/vendor/types.ts](../src/lib/trading/vendor/types.ts).
Methods are named for what the runner needs rather than how
Polymarket happens to expose it today:

| Method                 | Purpose                                                  | Network shape                                     |
| ---------------------- | -------------------------------------------------------- | ------------------------------------------------- |
| `discoverMarket`       | Locate the venue's market for an `(asset, windowStart)`  | REST GETs for Gamma + venue constraints           |
| `fetchBook`            | Top-of-book, depth, and venue tick/min-size constraints  | Two parallel REST GETs                            |
| `prepareMakerLimitBuy` | Validate/round/size a maker BUY without signing it       | Local/read-only                                   |
| `placeMakerLimitBuy`   | Sign + post a `postOnly: true` GTD limit BUY             | One REST POST (signed)                            |
| `placeTakerMarketBuy`  | Sign + post a FAK taker BUY capped by JIT book depth     | One REST POST (signed)                            |
| `cancelOrder`          | Cancel a resting order by id                             | One REST POST (signed)                            |
| `streamMarketData`     | Public market book/trade/resolution updates              | One public WS, auto-reconnecting                  |
| `streamUserFills`      | Long-lived WS for our wallet's fill events               | One auth WS, auto-reconnecting                    |
| `hydrateMarketState`   | Open orders + cumulative fills for one market            | Two parallel REST GETs (signed)                   |
| `resolveMarketOutcome` | Read official token winner for a market                  | One public REST GET                               |
| `scanLifetimePnl`      | Walk all wallet trades and compute realized lifetime PnL | Paginated REST + per-market REST (concurrency 10) |

`PostOnlyRejectionError` is a typed throw from `placeMakerLimitBuy`;
the runner's retry loop distinguishes it from generic errors.

## Lifecycle of a 5-minute window

Times are relative to the UTC 5m boundary at `T`.

```
T-30s    runner is mid-tick handler. "Pre-discovery" of the upcoming
         window's market has not yet happened. (Discovery happens at
         T+0 below — there is currently no eager pre-fetch.)

T+0      tick handler observes a new currentWindowStartMs.
         · Creates a fresh WindowRecord.
         · Per asset, fires discoverMarket + hydrateMarketState
           (async, in flight in parallel across all 5 assets).
         · Schedules cancelTimer for T+5m − ORDER_CANCEL_MARGIN_MS.
         · Schedules wrapUpTimer for T+5m + WINDOW_SUMMARY_DELAY_MS.

T+0…+1m  vendor.discoverMarket completes per asset. Line is captured
         from the first Binance tick after T. Book polling starts
         hitting the venue at BOOK_POLL_INTERVAL_MS (1.5 s).
         Decisions are evaluated continuously while slots remain
         empty, but flooredRemainingMinutes is null in this interval
         (the model has no snapshot for "no time elapsed yet"), so no
         trades fire.

T+1m     remaining = 4. The consensus evaluator returns its first non-null
         decision. If TAKE + slot still empty + market acceptingOrders:
         placeWithRetry forces a just-in-time book refresh, re-runs the
         consensus decision against that fresh book, walks chosen-side ask
         depth, and posts a FAK taker BUY capped by the worst consumed ask.
         Legacy maker mode still uses the GTD post-only retry branch.

T+2m,3m,4m  remaining flips to 3, 2, 1. The placement loop only fires
         at most once per window (slot stops being empty after the
         first successful place); subsequent boundaries log a fresh
         decision but don't place.

T+4:50   cancelTimer fires. cancelResidualOrders cancels every active
         slot's resting order so an unfilled order can't accidentally
         carry into the next window.

T+5:00   the venue marks the market closed. The kline_5m bar with
         openTime T closes; its `close` price is what the model uses
         to settle (note: not the same price the venue settles on,
         which is Chainlink — see "Model" above).

T+5:08   wrapUpTimer fires. wrapUpWindow:
         · settleRecord per asset → AssetWindowOutcome[].
         · Roll window net PnL into the lifetime accumulator.
         · Atomically rewrite tmp/lifetime-pnl.json.
         · formatWindowSummary + sendTelegramMessage.
         · Drop the WindowRecord from the runner's bookkeeping.
```

## API touchpoints

Every external dependency the live trader has, what it's used for,
how often it fires, and how long it takes — all measured against
real endpoints, not estimated. Numbers are a 5-sample median from a
non-US VPN (Canada) at 12:25 UTC; production latencies in Spain
should be in the same ballpark or slightly tighter due to the
straighter route to Polymarket's AWS infrastructure.

### Binance perp (price feed — vendor-agnostic)

`fapi.binance.com` is the live REST + WS endpoint. Geo-blocked from
the United States; works over any non-US VPN and natively from EU
hosts.

| Endpoint                           | Usage                                              | Frequency                                                         | Median latency                                                                |
| ---------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `GET /fapi/v1/klines?interval=5m`  | Boot-time bar-buffer hydration; exact-bar fallback | 5 calls at boot, then only when the buffer missed the prior close | **274 ms**                                                                    |
| `wss://fstream.binance.com/stream` | Combined `bookTicker` + `kline_5m` for 5 assets    | Continuous (1 socket)                                             | **~750 ms** to first frame after connect; thousands of ticks/sec steady-state |

Reconnect schedule: `[1, 2, 5, 10, 30] s` exponential. Stale-frame
watchdog resets the socket if no message lands for 5 s.

### Polymarket gamma-api (market discovery)

Public unauthenticated REST. Slug pattern is fixed: `<asset>-updown-5m-<unixSeconds>`.

| Endpoint                               | Usage                              | Frequency               | Median latency       |
| -------------------------------------- | ---------------------------------- | ----------------------- | -------------------- |
| `GET /events?slug=<slug>`              | One per asset per window discovery | 5 calls every 5 minutes | **84 ms**            |
| `GET /events?slug=...` × 5 in parallel | Per-window fan-out                 | 1 batch every 5 minutes | **82 ms** (parallel) |

### Polymarket CLOB REST (book reads + auth ops)

| Endpoint                                      | Usage                                         | Frequency                                       | Median latency  |
| --------------------------------------------- | --------------------------------------------- | ----------------------------------------------- | --------------- |
| `GET /book?token_id=...` × 2 in parallel      | Top-of-book for both YES tokens of one market | 5 markets every `BOOK_POLL_INTERVAL_MS` (1.5 s) | **209 ms**      |
| `GET /open-orders?market=...`                 | Boot-time hydration per market                | 5 markets per window                            | ~150 ms         |
| `GET /trades?market=...`                      | Boot-time hydration per market                | 5 markets per window                            | ~150 ms         |
| `POST /order` (auth)                          | Place one maker limit BUY                     | 0–1 per asset per window                        | ~250–500 ms     |
| `POST /order/cancel` (auth)                   | Cancel a residual order                       | ≤5 per window (one per active slot)             | ~200–400 ms     |
| `GET /trades` (paginated, auth)               | Lifetime PnL reconciliation                   | One pagination walk per live startup            | ~150 ms × pages |
| `GET /markets/<conditionId>` (concurrency 10) | Lifetime PnL reconciliation resolution lookup | ≤N unique markets per live startup              | ~200 ms each    |

A full lifetime scan over a fresh wallet is under a second; over a
several-thousand-trade wallet it can take 30 s – 2 min depending on
how many unique markets we have to resolve. The CLI prints
incremental progress so the operator can see it advancing.

### Polymarket CLOB WS

`wss://ws-subscriptions-clob.polymarket.com/ws/market`. Public
market channel used by dry trading to observe order-book changes,
last trade prices, tick-size changes, and official resolution events.
Subscriptions are by CLOB token id and include
`custom_feature_enabled: true` so `best_bid_ask` and `market_resolved`
frames are emitted. Dry trading uses `last_trade_price` frames for
queue-aware fill simulation and `market_resolved` as the fastest
official outcome source, with REST resolution as fallback.

`wss://ws-subscriptions-clob.polymarket.com/ws/user`. Authenticated
user channel used only by live trading.

| Stream       | Usage                                       | Frequency                                                                                                  |
| ------------ | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `/ws/market` | Public market book/trade/resolution events  | Continuous, narrowed to active token IDs; dry-run resubscribes on market discovery                         |
| `/ws/user`   | Real-time fill notifications for our wallet | Continuous, narrowed to active conditionIds; live resubscribes on every market discovery (~once per 5 min) |

Reconnect schedule mirrors the live price feed: `[1, 2, 5, 10, 30] s`.
The user stream authenticates on connect; the market stream is public.

### Telegram Bot API

| Endpoint            | Usage                                   | Frequency                                                                                            |
| ------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `POST /sendMessage` | Order placement + window summary alerts | Up to 5 per window (one per asset placement) + 1 per window (summary). Order-error alerts are rarer. |

Telegram sends are fire-and-forget — they never block the trading
loop. A failed send logs a `warn` and keeps moving.

### Filesystem

| Path                                            | Usage                      | Frequency                                                                    |
| ----------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------- |
| `tmp/lifetime-pnl.json` (atomic write)          | Lifetime PnL checkpoint    | Read at boot; rewritten after startup reconciliation and once per window-end |
| `tmp/dry-trading/dry-trading_<timestamp>.jsonl` | Dry-trading session ledger | New file per dry-run session; append session/window/order records            |

## Failure modes and recovery

The runner is built to keep going through every transient failure
that doesn't put real money at risk. Cataloged so an operator
reading a long log stretch knows what's normal:

| Symptom                                                              | What's happening                                                                       | Runner behaviour                                                                                                                                                                                               |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `binance-perp ws disconnected`                                       | Socket dropped (network blip, Binance hiccup)                                          | Exponential reconnect; price decisions are stale until it returns                                                                                                                                              |
| `polymarket user ws disconnected`                                    | Same, on the user channel                                                              | Same exponential reconnect; fills missed during the gap surface on next hydration                                                                                                                              |
| `${asset} no polymarket market for window …`                         | Slug not yet in gamma-api                                                              | Skip this asset for the window; retry on next 5m boundary                                                                                                                                                      |
| `${asset} postOnly rejection (#N)`                                   | Legacy maker mode only: price moved between book read and post                         | Re-fetch book → re-evaluate → retry; counted in window summary as `Cross-book rejections`                                                                                                                      |
| `${asset} taker book walk failed before placement`                   | Chosen ask book had no usable taker depth                                              | Skip this asset for the window                                                                                                                                                                                 |
| `${asset} place failed (after retry)`                                | Generic post error, even after one silent retry                                        | Skip this asset for the window; fire-and-forget Telegram alert                                                                                                                                                 |
| `lifetime pnl reconciliation failed`                                 | Startup venue-truth scan failed after a checkpoint loaded                              | Keep the loaded checkpoint and continue; operator can run `trading:hydrate-lifetime-pnl` manually                                                                                                              |
| `lifetime pnl persist failed`                                        | Disk error on the checkpoint write                                                     | Continue; the in-memory accumulator is still correct, next window will retry the persist                                                                                                                       |
| `window summary telegram send failed`                                | Telegram API hiccup                                                                    | Continue; the next window's summary will reflect the same lifetime total                                                                                                                                       |
| `${asset} state hydration failed`                                    | `getOpenOrders` or `getTrades` failed at boot                                          | Slot starts empty; if there was a leftover open order on the venue we'll observe its fill via the user WS, or cancel it at wrap-up                                                                             |
| `window … settlement gave up after 30 retries; finalizing without …` | The 5m closing bar for some asset never arrived (Binance gap or REST fallback failure) | Window finalizes without the missing asset's outcome; that asset's bet contributes 0 to PnL for the window. Capped at 30 retries (~60s total) so a permanent gap can't hold a `WindowRecord` in memory forever |

What the runner explicitly **doesn't** do, by design:

- Hold more than one order or position per asset at a time. The slot
  state machine refuses to start a new placement unless the slot is
  empty.
- Carry orders or positions across windows. Taker orders are FAK, and
  any legacy maker residual orders are cancelled at T+5m − 10 s;
  positions settle on the venue at T+5m and become USDC.
- Persist anything except the lifetime-PnL counter. Every other
  piece of state is reconstructed from the venue on the next boot.

## Telegram messages

### Order placement

```
Placed order for $20 of BTC ↑ @ $80,251.35

Price line is $80,253.10 (+0.002%)
Market expires in 2 minutes 20 seconds.
```

The `(+0.002%)` is `(line − current) / current × 100`. Positive =
line is above current price (so the current side is DOWN). Three
decimal digits max, sign always shown.

### Window summary (~8 s after window close)

Layout is: per-asset list → blank line → window-scoped block
(`Latest Window Pnl` + optional `Cross-book rejections`) → blank
line → lifetime `Total Pnl`.

Mixed window with rejections that retried into fills:

```
BTC: ↑ @ $0.31 → won +$44.51
ETH: ↑ @ $0.42 → won +$27.62
SOL: no trade
XRP: ↓ @ $0.18 → didn't fill
DOGE: no trade

Latest Window Pnl: +$72.13
Cross-book rejections: 5 (2 placed after retry)

Total Pnl: +$1,234.56
```

Clean window where no asset traded:

```
No trades entered this market.

Latest Window Pnl: $0.00

Total Pnl: -$143.21
```

### Order error alert (only after one silent retry also failed)

```
Error placing SOL ↑ order: polymarket clob 502 (gateway timeout)

(Retried once. Bot continues.)
```

## Commands

### `trading:gen-probability-table`

`bun alea trading:gen-probability-table` reads the local Postgres
for the configured training candle series (binance-perp, 5m + 1m),
walks the snapshot pipeline once, partitions snapshots by every algo
in `LIVE_TRADING_REGIME_ALGOS`, persists a `LeadingRegimeTable` for
every (algo, regime) pair whose hold-rate beats baseline by at least
`LEADING_REGIME_MIN_LEAD_PP` (1.0pp), restricts each surface to its
sweet-spot bp range, and overwrites
`src/lib/trading/probabilityTable/probabilityTable.generated.ts`
plus a JSON sidecar in `tmp/`. Run this whenever the underlying
training data has been refreshed and you want the live trader to use
the new model. The generated file is committed on purpose: every
model change shows up as a reviewable diff.

### `trading:dry-run`

`bun alea trading:dry-run` runs the live four-source consensus/taker
decision path against real feeds without signing, placing, or cancelling
any order. See [Dry Trading](./DRY_TRADING.md) for the fill model, JSONL
ledger, Telegram behavior, and report interpretation.

### `trading:dry-run-report`

`bun alea trading:dry-run-report` renders the newest dry-trading JSONL
session in `tmp/dry-trading/` into a standalone Alea-styled HTML report
under `tmp/`, with a JSON sidecar for later slicing. Pass
`--session <path>` to render a specific dry-run session and `--no-open`
to skip opening the HTML on macOS. See [Dry Trading](./DRY_TRADING.md)
for the canonical report schema and metric definitions.

### `trading:live --commit`

`bun alea trading:live --commit` is the production trader.
Constructs the Polymarket vendor with `eagerAuth: true` (fails fast
on missing wallet env), opens all the streams, places FAK taker BUYs
($20 stake) for four-source consensus signals with venue-provided
tick/min-size constraints, watches fills via the user WS, settles each
window with real PnL net of the same normalized Polymarket fill fees
used by the performance dashboard, and ships the per-window Telegram
summary. Refuses to start without `--commit`.

### `trading:hydrate-lifetime-pnl`

`bun alea trading:hydrate-lifetime-pnl` rescans the wallet's full
Polymarket trade history and overwrites the lifetime-PnL
checkpoint. Useful after manual trades on the wallet outside the
bot, or whenever the checkpoint feels stale. Read-only against
Polymarket — never places or cancels orders.

### `trading:performance`

`bun alea trading:performance` scans the configured wallet's full
authenticated Polymarket CLOB trade history, fetches touched CLOB
markets for resolution metadata, and writes a `tmp/` HTML dashboard
plus JSON sidecar. It uses only Polymarket API data, does not touch the
database, and shares the same post-fee PnL normalization as the live
runner and lifetime-PnL scanner.

### `trading:replay` and `trading:replay-report`

`bun alea trading:replay` walks every captured 5-minute window in
the `market_event` table through the same `evaluateDecision` +
`fillSimulation` pipeline live and dry-run use, and emits a JSONL
session under `tmp/replay-trading/` that's bit-compatible with the
dry-run report parser. Settlement uses the captured chainlink
reference-price feed as truth; the polymarket `resolved` event is
carried alongside as a cross-check. `bun alea trading:replay-report`
renders the session into an HTML dashboard. See
[Replay](./REPLAY.md) for the full workflow.

## Files

Vendor-agnostic core:

- Types: [src/lib/trading/types.ts](../src/lib/trading/types.ts)
- Trading constants: [src/constants/trading.ts](../src/constants/trading.ts)
- Decision evaluator: [src/lib/trading/decision/evaluateDecision.ts](../src/lib/trading/decision/evaluateDecision.ts)
- Slot state machine: [src/lib/trading/state/types.ts](../src/lib/trading/state/types.ts)
- Settlement math: [src/lib/trading/state/settleFilled.ts](../src/lib/trading/state/settleFilled.ts)
- Lifetime PnL store: [src/lib/trading/state/lifetimePnlStore.ts](../src/lib/trading/state/lifetimePnlStore.ts)
- Lifetime PnL math (pure): [src/lib/trading/state/computeLifetimePnl.ts](../src/lib/trading/state/computeLifetimePnl.ts)
- Telegram composers: [src/lib/trading/telegram/](../src/lib/trading/telegram/)
- Live runner (orchestrator + per-concern modules): [src/lib/trading/live/](../src/lib/trading/live/)
- Dry-run simulator: [src/lib/trading/dryRun/](../src/lib/trading/dryRun/)
- Probability table types + generator: [src/lib/trading/](../src/lib/trading/)
- Live price feed: [src/lib/livePrices/](../src/lib/livePrices/)

Vendor interface + Polymarket implementation:

- Interface: [src/lib/trading/vendor/types.ts](../src/lib/trading/vendor/types.ts)
- Polymarket adapter: [src/lib/trading/vendor/polymarket/](../src/lib/trading/vendor/polymarket/)

CLIs:

- [src/bin/trading/genProbabilityTable.ts](../src/bin/trading/genProbabilityTable.ts)
- [src/bin/trading/dryRun.ts](../src/bin/trading/dryRun.ts)
- [src/bin/trading/dryRunReport.ts](../src/bin/trading/dryRunReport.ts)
- [src/bin/trading/live.ts](../src/bin/trading/live.ts)
- [src/bin/trading/hydrateLifetimePnl.ts](../src/bin/trading/hydrateLifetimePnl.ts)
- [src/bin/trading/performance.ts](../src/bin/trading/performance.ts)
- [src/bin/trading/replay.ts](../src/bin/trading/replay.ts)
- [src/bin/trading/replayReport.ts](../src/bin/trading/replayReport.ts)

Replay infrastructure: [src/lib/trading/replay/](../src/lib/trading/replay/) (engine + report renderer; see [Replay](./REPLAY.md)).
