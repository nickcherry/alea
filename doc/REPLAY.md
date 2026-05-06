# Replay

Offline replay of the live trading decision + maker-order + fill-simulation pipeline against a previously-captured `market_event` tape. Lets threshold tuning, regime promotion experiments, and dynamic-cancel work iterate in seconds against weeks of recorded data instead of an overnight live dry-run.

Replay reuses [`evaluateDecision`](../src/lib/trading/decision/evaluateDecision.ts), the [fill simulator](../src/lib/trading/dryRun/fillSimulation.ts), the [PnL metrics](../src/lib/trading/dryRun/metrics.ts), and the [telemetry builders](../src/lib/trading/dryRun/telemetry.ts) verbatim — the per-window driver and the data sources are the only replay-specific pieces. Output JSONL is bit-compatible with the dry-run report parser.

## Quick start

You need data captured into the `market_event` table first:

```sh
bun alea db:migrate
bun alea data:capture     # leave running for at least one full window + ~2 min for the resolved event
```

See [Market Capture](./MARKET_CAPTURE.md) for the capture pipeline.

Then replay:

```sh
bun alea trading:replay
```

Defaults: replays every 5-minute window present in `market_event` for all five whitelisted assets at the standard `MIN_EDGE` (0.05). Writes a JSONL session under `tmp/replay-trading/replay-trading_<UTC-iso>.jsonl`, prints per-window summaries plus session totals.

Render the dashboard:

```sh
bun alea trading:replay-report
```

Defaults to the newest `tmp/replay-trading/replay-trading_*.jsonl`, writes an HTML + JSON sidecar under `tmp/`, opens the HTML on macOS.

## Settlement: chainlink as truth

Each window's winning side comes from the captured polymarket-chainlink reference-price feed (the actual settlement source for the up/down 5m markets). The mechanics:

1. Pick the chainlink reference value at-or-just-before `windowStart` → `chainlinkLine`.
2. Pick the chainlink reference value at-or-just-before `windowEnd` → `chainlinkClose`.
3. `winningSide = chainlinkClose >= chainlinkLine ? "up" : "down"`.

The captured polymarket `resolved` event for the same market is carried alongside as a cross-check; any disagreement is surfaced per-order in the JSONL (`replayOutcome.disagreementWithPolymarket: true`) and counted in the dashboard's "Settlement mismatch" stat. Disagreement should be rare on healthy data; persistent mismatches usually mean the captured chainlink coverage was incomplete around a window boundary (the resolver flags `line-after-window-start` / `close-after-window-end` when it had to fall back to a future event for the line/close pick).

If chainlink coverage is missing for a window the order is **excluded from PnL aggregates** and a warning is logged — a single bad window doesn't blow away a multi-day replay's totals.

## Output

Replay JSONL events match the [dry-run JSONL shape](./DRY_TRADING.md) so the same report parser works on either:

- `session_start` — config (vendor, priceSource, assets, minEdge, stakeUsd, tableRange, replay range)
- `virtual_order` — per-order envelope with all the dry-run telemetry: entryPrice, queueAheadShares, modelProbability, edge, full entry-book / pre-entry-market / lead-time counterfactuals
- `virtual_fill` — fill events when the simulated trade absorbs polymarket trades
- `window_finalized` — per-window metrics + session running totals + a `replayChainlink` blob carrying chainlink/polymarket settlement + mismatch flag per asset
- `session_stop` — final aggregates

Anything dry-run records, replay records.

## Architecture

```
                ┌────────────────────────────────┐
                │  market_event (Postgres)       │
                │  binance-perp BBO/kline-close  │
                │  polymarket book/trade/bba/    │
                │    resolved                    │
                │  polymarket-chainlink          │
                │    reference-price             │
                └────────────────┬───────────────┘
                                 │
              ┌──────────────────▼──────────────────┐
              │  loadMarketEvents (cursor stream)   │
              └──────────────────┬──────────────────┘
                                 │
       ┌─────────────────────────┼─────────────────────────┐
       │                         │                         │
       ▼                         ▼                         ▼
buildReplayMarketManifest  bucketChainlinkByAsset  loadTrainingCandles
(asset/window → up/down    (per-asset chainlink     (5m bars to bootstrap
  from resolved events)     slice for resolution)    RegimeTrackers)
       │                         │                         │
       └─────────────┬───────────┴───────────┬─────────────┘
                     ▼                       ▼
              ┌──────────────────────────────────────┐
              │  per-window:                         │
              │   replayWindow(events, markets,      │
              │                trackers, table) ─────┼─→ evaluateDecision
              │     ↓ JSONL writer                   │   fillSimulation
              └──────────────────────────────────────┘   telemetry builders
```

Two database passes:

1. **Manifest scan** — stream every polymarket event in the replay range to derive per-window `(asset → market)` mappings. Up/down comes from the captured `resolved` event for each market: `winningOutcomeRef + winningSide` pin one tokenId to a side, and the other tokenId observed in the same `vendorRef`'s book/trade events is the opposite side. Markets without a captured `resolved` event are skipped (logged) — typically the most recent few windows that didn't have time to resolve before capture stopped.

2. **Per-window replay** — for each window in chronological order, query just that window's binance + polymarket events plus the per-asset chainlink slice; hydrate the regime trackers from the candles table for the 70 bars before `windowStart`; call `replayWindow`.

The per-window driver walks events in time order and dispatches by source/kind:
- `binance-perp/bbo` updates `lastTick` and (if not yet captured for this window) sets `state.line` from the first tick within `MAX_LINE_CAPTURE_LAG_MS` of `windowStart`
- `polymarket/book` and `polymarket/best-bid-ask` apply to the maintained `UpDownBook`; if the asset's slot is still empty, an evaluation fires
- `polymarket/trade` appends to the per-outcome trade history; if a simulated order is active on the chosen outcome, the fill simulator absorbs the trade
- minute-boundary ticks (`+1m`, `+2m`, `+3m`, `+4m`) fire a per-asset evaluation if the bucket flipped or the slot is still empty

This mirrors live behaviour: decisions fire on bucket flips and book updates while the slot is empty, exactly like the 250ms tick + book-poll loop in `runLive` does.

## Limitations

- **Replay needs prior REST-equivalent data**. Regime trackers must be seeded with ~70 closed 5m bars before the first replayable window. The local `candles` table is the source — run `bun alea candles:sync` if you've fallen behind. Without seed bars, `evaluateDecision` returns `warmup` and no trades fire.
- **Line capture requires capture to have started before `windowStart`**. If the binance bbo stream's first tick lands more than `MAX_LINE_CAPTURE_LAG_MS` (5s) past `windowStart`, the window has no captured line and decisions can't fire — same as live behaviour.
- **Up/down depends on the captured `resolved` event**. Polymarket up/down 5m markets resolve ~1.5 minutes after window-end. If capture stops before resolution fires, those windows are skipped at manifest derivation time. Plan capture runs to extend at least 2 minutes past the last window you care about.
- **Polymarket `prepareMakerLimitBuy` is reproduced inline** with hard-coded constants matching the typical up/down 5m market (0.01 tick, 5-share min, 60s GTD validity). Markets that diverge from those (rare) won't replay bit-perfectly. Future work could fetch + cache real venue constraints per market.

## Files

- Engine: [src/lib/trading/replay/](../src/lib/trading/replay/)
  - [`loadMarketEvents.ts`](../src/lib/trading/replay/loadMarketEvents.ts) — DB → typed event stream with cursor pagination
  - [`derivedMarkets.ts`](../src/lib/trading/replay/derivedMarkets.ts) — `(asset, window) → market` from captured polymarket events
  - [`resolveWindowOutcome.ts`](../src/lib/trading/replay/resolveWindowOutcome.ts) — chainlink truth + polymarket cross-check
  - [`replayWindow.ts`](../src/lib/trading/replay/replayWindow.ts) — per-window driver
  - [`runReplay.ts`](../src/lib/trading/replay/runReplay.ts) — top-level orchestrator
- Report: [src/lib/trading/replay/report/](../src/lib/trading/replay/report/) — duplicated from [`dryRun/report/`](../src/lib/trading/dryRun/report/) so divergence is intentional rather than accidental
- CLI:
  - [src/bin/trading/replay.ts](../src/bin/trading/replay.ts)
  - [src/bin/trading/replayReport.ts](../src/bin/trading/replayReport.ts)
- See also: [Market Capture](./MARKET_CAPTURE.md), [Dry Trading](./DRY_TRADING.md), [Trading Domain](./TRADING.md), [Regimes](./REGIMES.md).
