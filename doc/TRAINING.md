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

The broader candle store can hold `1m` and `1h` bars. Training evaluates
the trade-decision periods only (`5m` and `15m`), but it also reads `1m`
Pyth/Coinbase candles to reconstruct what the decision path would have known
before the target market opened.

## Window

Training starts at the earliest matching Pyth spot candle in the local
DB and uses a half-open upper bound of
`2026-04-01T00:00:00.000Z`, i.e. the inclusive end is
`2026-03-31T23:59:59.999Z`.

Each training pass loads aligned Pyth/Coinbase period candles plus aligned
`1m` candles. Pyth spot defines the canonical timeline and labels the
target-bar outcome; Coinbase spot is only the input source for filters whose
`barSource` is `"coinbase"`. If Coinbase has a gap inside one of those
filters' required windows, that moment is treated as an abstain for the
candidate rather than a win or loss.

`TRAINING_PROFILE_ID` combines the outcome-labeling rule, decision-input
semantics, and research-window identity. Changing any of those invalidates old
`filter_runs` and old committee rosters until `training:run` and
`committee:select` are refreshed.

## No-Leak Invariant

For each target period bar, training uses the configured live/dry-run decision
lead (`5m` at T-2m, `15m` at T-3m). The filter sees closed period bars plus a
synthetic in-flight period bar built from completed `1m` candles available at
that lead. It does not see the target bar or the final close/high/low of the
pre-target period bar. Tiny Pyth moves are treated as ambiguous via
`TRAINING_OUTCOME_MIN_ABS_MOVE_PCT` and do not create `filter_engagements`
rows.

## Files

- [`src/lib/backtest/runBacktest.ts`](../src/lib/backtest/runBacktest.ts) —
  historical filter-training walker and cache logic.
- [`src/bin/backtest/run.ts`](../src/bin/backtest/run.ts) —
  `training:run` CLI.
- [`src/constants/training.ts`](../src/constants/training.ts) —
  outcome threshold + profile id.
- [`src/lib/training/resolveTrainingOutcomeDirection.ts`](../src/lib/training/resolveTrainingOutcomeDirection.ts) —
  maps target candles to `up`, `down`, or ambiguous.
