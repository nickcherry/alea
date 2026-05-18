# Proxy Accuracy

This is the historical, ground-truth version of the live
[directional agreement experiment](./RELIABILITY_EXPERIMENT.md).

## Purpose

We make chart decisions from Pyth open/close candles, but Polymarket's
crypto up/down markets settle on a Chainlink Data Streams price feed.
That difference would be a problem if Pyth said "up" on enough bars
where Chainlink said "down" — the chart decision path would optimize
against the wrong historical target.

`reliability:capture` checks this with live boundary ticks, but it can
only run forward in time. The proxy-accuracy dashboard answers the
same question across the historical window: for every settled
Polymarket up/down market on `(asset, timeframe)`, did the Pyth bar's
open→close direction match the Chainlink-derived winner?

## Pipeline

1. **Resolutions sync** — `bun alea polymarket:resolutions-sync` walks
   `1h` Polymarket up/down markets by default. The deployed dashboard filters
   to `1h` via
   [`DASHBOARD_RESOLUTION_TIMEFRAMES`](../src/constants/dashboard.ts). Each
   settled market goes into `polymarket_resolutions`, keyed by asset,
   timeframe, and `window_start_ts_ms`. Pending markets are skipped
   (re-fetched next run). Void / refund markets are stored so they aren't
   re-fetched but excluded from the agreement math.
2. **Pyth candles** — already covered by `candles:sync`. The dashboard
   joins on `(source=pyth, product=spot, asset, timeframe, timestamp)`.
3. **Dashboard build** — `dashboards:build` loads paired windows,
   computes per-(timeframe, asset) agreement rate, splits disagreements
   by Pyth move size, and surfaces the worst (biggest |move%|)
   disagreements for audit.

## Reading the dashboard

- **Agreement rate** is over joined windows only. Void Polymarket rows
  and missing Pyth bars are surfaced separately in the coverage strip.
- **Below threshold share** is the share of disagreements whose Pyth
  move% is smaller than `OUTCOME_MIN_ABS_MOVE_PCT`. The
  threshold marks tiny Pyth moves as noise for proxy interpretation, so
  a high share means disagreements are mostly small-move noise.
- **Clear-move disagreements** count flips above that threshold — each
  one is a window where Pyth would have shown the chart-decision path
  the wrong side. Watch this number more than the overall agreement
  rate.
- **Disagreement histogram** vs **all-windows histogram** is the
  diagnostic: if disagreements are over-represented at higher move
  buckets relative to where bars naturally live, the proxy is drifting
  rather than just noise-flipping.

## Files

- Migration: [`202605120700_create_polymarket_resolutions.ts`](../src/lib/db/migrations/202605120700_create_polymarket_resolutions.ts)
- Fetcher: [`src/lib/polymarket/fetchResolution.ts`](../src/lib/polymarket/fetchResolution.ts)
- Sync: [`src/lib/polymarket/syncResolutions.ts`](../src/lib/polymarket/syncResolutions.ts)
- CLI: [`src/bin/polymarket/resolutionsSync.ts`](../src/bin/polymarket/resolutionsSync.ts)
- Dashboard: [`src/lib/polymarket/dashboard/`](../src/lib/polymarket/dashboard/)

## Polymarket retention

Hourly retention has not yet been measured; current and next-hour slugs were
verified live on 2026-05-17. Beyond retention, the gamma-api
`/events?slug=…` endpoint returns an empty event list and the sync records
nothing for that window. The endpoint is marked
`Deprecation: true / Sunset: 2026-05-01` — still serving traffic at time of
writing; the documented successor is `/events/keyset`, which the sync layer can
adopt without touching the persistence shape.
