# Filter Training

`training:run` evaluates every registered `(filter, config)` candidate
at every supported `(period, asset)` combination inside the configured
training window, then persists aggregate counts to `filter_runs` and
individual non-abstain predictions to `filter_engagements`.

Run it:

```sh
bun alea training:run
```

Rows are cached by exact candle range and active `TRAINING_PROFILE_ID`.
Use `--filters filter_id1,filter_id2`, `--periods 5m`, or
`--assets btc,eth` to slice.

## Window

Training starts at the earliest matching Pyth spot candle in the local
DB and uses a half-open upper bound of
`2026-04-01T00:00:00.000Z`, i.e. the inclusive end is
`2026-03-31T23:59:59.999Z`.

`TRAINING_PROFILE_ID` combines the outcome-labeling rule with the
research-window identity. Changing either invalidates old `filter_runs`
and old committee rosters until `training:run` and `committee:select`
are refreshed.

## No-Leak Invariant

At bar `i`, a filter sees `bars[i - requiredBars + 1 .. i]`; the
target bar is `bars[i + 1]` and is only read after the prediction is
locked in. Tiny Pyth moves are treated as ambiguous via
`TRAINING_OUTCOME_MIN_ABS_MOVE_PCT` and do not create
`filter_engagements` rows.

## Files

- [`src/lib/backtest/runBacktest.ts`](../src/lib/backtest/runBacktest.ts) —
  historical filter-training walker and cache logic.
- [`src/bin/backtest/run.ts`](../src/bin/backtest/run.ts) —
  `training:run` CLI.
- [`src/constants/training.ts`](../src/constants/training.ts) —
  outcome threshold + profile id.
- [`src/lib/training/resolveTrainingOutcomeDirection.ts`](../src/lib/training/resolveTrainingOutcomeDirection.ts) —
  maps target candles to `up`, `down`, or ambiguous.
