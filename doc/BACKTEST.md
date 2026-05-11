# Backtest Framework

The filter-committee backtest is the engine behind the
`/exploration/` dashboard. It evaluates every registered (filter,
config) candidate at every supported (period, asset) combination
against three years of pyth/spot candles, and persists both the
aggregate counts and every individual prediction to Postgres.

Run it:

```sh
bun alea backtest:run
```

Re-runs are cheap: rows in `filter_runs` whose `range_last_ms`
already covers the available candles are skipped. Use `--filters
filter_id1,filter_id2` or `--periods 5m`/`--assets btc,eth` to slice.

## What a "filter" is

The full filter contract lives in [FILTERS.md](./FILTERS.md). The
short version: each filter is a tiny deterministic predictor that
gets a trailing bar window and emits `"up" | "down" | null`. A
`null` is an abstention and doesn't contribute to the win rate.

A filter does **not** see the bar it's predicting. At decision time
`window` is `bars[i - requiredBars + 1 .. i]` inclusive — the last
entry is the just-closed bar `i`, and the prediction subject is
`bars[i + 1]`. The walker enforces this; see "No-leak invariant"
below.

Filters live in [`src/lib/filters/`](../src/lib/filters/). Each
file calls `registerFilter` and ships a `defaultConfigs()` array —
that's the set the backtest walks.

## No-leak invariant

`walkBars` in `src/lib/backtest/runBacktest.ts` is the only place
that touches bar `i + 1`, and only after the prediction is locked
in:

```ts
const window = bars.slice(i - requiredBars + 1, i + 1); // exclusive of i+1
const pred = predict(window); // sees only past + current closed bar
const next = bars[i + 1]!; // ONLY used to score
const actual = next.close >= next.open ? "up" : "down"; // tie rounds up
```

If you add a new filter, your `predict` is handed `window` and that's
the only data you get. Don't grab anything from outer scope.

Flat candles (`close === open`) count as `"up"` per the trader rule
"0 rounds up" — this matches how Polymarket's up/down contracts
settle.

## Storage

Two tables back the framework:

`filter_runs` — aggregate cache, one row per
`(filter_id, filter_version, config_canon, period, asset)`. PK is a
SHA-256-derived `run_hash` over those five identity fields. Holds
just the counters (`n_engagements_up`, `n_wins_up`, `n_engagements_down`,
`n_wins_down`, etc.) plus the `range_first_ms`/`range_last_ms`
window the row summarises. The leaderboard query reads from here.

`filter_engagements` — append-only per-prediction tape. One row per
non-abstain engagement:

| column      | type     | meaning                                             |
| ----------- | -------- | --------------------------------------------------- |
| `run_hash`  | text     | joins to `filter_runs`                              |
| `ts_ms`     | bigint   | open-time of the candle being predicted (bar `i+1`) |
| `direction` | char(1)  | `'u'` or `'d'`                                      |
| `won`       | smallint | `0` or `1`                                          |

Primary key `(run_hash, ts_ms)` covers the two natural query
shapes: "all engagements for this candidate" (range scan on
`run_hash`) and "Q1 2025 for this candidate" (the same range scan
plus a `ts_ms` filter via `to_timestamp`).

Storage is comfortable: ~23M engagement rows in the current set
(~25 B payload ≈ ~600 MB raw plus index overhead). Quarterly
aggregation across all candidates runs in well under 10s.

The aggregate counts on `filter_runs` and the engagements on
`filter_engagements` are written inside the same transaction in
`runBacktestForCandidate`, so a reader never sees a torn write
("old aggregates + new engagements" or vice versa).

## Regime stratification

Every historical bar is tagged with a market regime (see
[REGIMES.md](./REGIMES.md)). The exploration loader joins
`filter_engagements` with `bar_regimes` on
`(asset, period, ts_ms)` to compute per-(candidate, regime)
aggregates and per-(candidate, regime, quarter) strips. The
dashboard surfaces this as the regime selector tabs — picking a
specific regime re-aggregates the leaderboard to "how did this
config perform when the market was in _that_ state".

The same join feeds `committee:select` (see
[COMMITTEE.md](./COMMITTEE.md)), which uses regime-stratified
backtest stats to choose which candidates can vote in which regime.

## Quarter buckets

Per-quarter slices on the dashboard are derived at payload-build
time, not stored:

```sql
select
  fe.run_hash,
  extract(year from to_timestamp(fe.ts_ms / 1000.0))::int as year,
  extract(quarter from to_timestamp(fe.ts_ms / 1000.0))::int as quarter,
  count(*) as n_engagements,
  sum(fe.won) as n_wins
from filter_engagements fe
group by fe.run_hash, year, quarter;
```

The exploration loader runs this once per dashboard build, then
folds per-asset rows together so each (filter, config, period)
candidate has a single chronological quarter list. A second query
adds regime + quarter to the GROUP BY for the regime-scoped view.
Min/max win rates across quarters surface in the UI as the dedicated
"Min Q WR" / "Max Q WR" columns.

## Adding a filter

See [FILTERS.md](./FILTERS.md#adding-a-filter) for the full recipe.
Short version: drop a new file under `src/lib/filters/`, register
it, import from `all.ts`, re-run `backtest:run`, then
`committee:select` if you want the new candidates eligible for the
live committee.

## Files

- [`src/lib/backtest/runBacktest.ts`](../src/lib/backtest/runBacktest.ts) —
  the walker + cache logic.
- [`src/lib/filters/`](../src/lib/filters/) — types, registry, hash
  helpers, and every registered filter.
- [`src/lib/indicators/`](../src/lib/indicators/) — pure numeric
  primitives (RSI / SMA / EMA / Bollinger / etc.) the filters
  compose.
- [`src/lib/exploration/`](../src/lib/exploration/) — payload
  builder + renderer for the exploration dashboard.
- [`src/bin/backtest/run.ts`](../src/bin/backtest/run.ts) — the CLI
  command.
- [`src/lib/db/migrations/202605110000_create_filter_runs.ts`](../src/lib/db/migrations/202605110000_create_filter_runs.ts)
  - [`202605120000_create_filter_engagements.ts`](../src/lib/db/migrations/202605120000_create_filter_engagements.ts)
    — schemas.
