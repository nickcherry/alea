# Backtest Framework

The current `backtest:run` command is the engine behind the
`/backtest/` and `/exploration/` dashboards. It evaluates every
registered (filter, config) candidate at every supported (period,
asset) combination inside the configured training window, and
persists both the aggregate counts and every individual prediction to
Postgres.

This is filter training, despite the historical command name. The new
committee-backtest paradigm is a separate holdout phase: replay the
selected trade committee after the training window, without Polymarket
order-book simulation, to calibrate voting policy before dry-run/live.

Run it:

```sh
bun alea backtest:run
```

Re-runs are cheap after the active profile is populated: rows in
`filter_runs` whose stored range exactly matches the configured
training window and active training profile are skipped. Use
`--filters filter_id1,filter_id2` or `--periods 5m`/`--assets btc,eth`
to slice.

## Research windows

Window settings live in
[`src/constants/researchWindows.ts`](../src/constants/researchWindows.ts).
Training starts at the earliest matching Pyth spot candle in the local
DB and uses a half-open upper bound of
`2026-04-01T00:00:00.000Z`, i.e. the inclusive end is
`2026-03-31T23:59:59.999Z`. Committee backtests start immediately at
`2026-04-01T00:00:00.000Z` and end at the start of the current UTC day
so they cover complete candles through yesterday.

`TRAINING_PROFILE_ID` combines the outcome-labeling rule with this
research-window identity. Changing either the outcome threshold or the
window invalidates old `filter_runs` and old committee rosters until
`backtest:run` and `committee:select` are refreshed.

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
const actual = resolveTrainingOutcomeDirection(next); // null if move is too small
if (actual === null) continue;
```

If you add a new filter, your `predict` is handed `window` and that's
the only data you get. Don't grab anything from outer scope.

Training outcomes use
`TRAINING_OUTCOME_MIN_ABS_MOVE_PCT` in
[`src/constants/training.ts`](../src/constants/training.ts). If the
Pyth candle closes inside that percent band around its open, the
prediction is treated as ambiguous and does not create a
`filter_engagements` row. This keeps barely-moved Pyth candles from
contributing wins or losses when Polymarket settlement is based on a
different reference feed.

## Storage

Two tables back the framework:

`filter_runs` — aggregate cache, one row per
`(filter_id, filter_version, config_canon, period, asset)`. PK is a
SHA-256-derived `run_hash` over those five identity fields. Holds
just the counters (`n_engagements_up`, `n_wins_up`, `n_engagements_down`,
`n_wins_down`, etc.) plus the `range_first_ms`/`range_last_ms`
window the row summarises. The leaderboard query reads from here.

`filter_engagements` — append-only per-prediction tape. One row per
non-abstain engagement with a non-ambiguous target outcome:

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

Each `filter_runs` row also carries `training_profile`, so cached rows
from older outcome-label rules or older research windows are ignored
until `backtest:run` recomputes them under the active profile.

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
training stats to choose which candidates can vote in which regime.

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
- [`src/constants/training.ts`](../src/constants/training.ts) — training
  outcome threshold + profile id.
- [`src/lib/training/resolveTrainingOutcomeDirection.ts`](../src/lib/training/resolveTrainingOutcomeDirection.ts) —
  maps target candles to `up`, `down`, or ambiguous.
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
