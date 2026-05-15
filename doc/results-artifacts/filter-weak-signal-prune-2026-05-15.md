# Filter Weak-Signal Prune 2026-05-15

## Scope

Retired six active filters after the config sweep and Claude cross-check.
The goal was not to delete code. Implementations remain under
`src/lib/filters/` for later reactivation, but their side-effect imports
were removed from `src/lib/filters/all.ts`.

## Retired From Active Registration

- `effort_vs_result_fade` — distinct mechanism, but lowest Wilson in
  the active registry: 52.49% best-config WR / 50.79% Wilson, only
  four committee rows, no rank-1 slots.
- `supertrend_retest_follow` — trend-continuation holdout with 52.36%
  best-config WR / 51.29% Wilson, four committee rows, no rank-1
  slots.
- `macd_histogram_turn_fade` — lowest committee adoption among active
  filters: three committee rows, no rank-1 slots, 52.89% best-config
  WR / 52.18% Wilson.
- `high_volume_failed_breakout_fade` — weaker failed-breakout sibling
  to `low_volume_breakout_fade`: 53.17% best-config WR / 51.99%
  Wilson, five committee rows, no rank-1 slots.
- `atr_burst_fade` — single-bar velocity fade with stronger nearby
  peers. Best-config WR was 53.44% / 52.49% Wilson; four committee rows
  and no rank-1 slots.
- `bollinger_recovery` — lagged Bollinger confirmation variant.
  Best-config WR was 54.05% / 53.38% Wilson, ten committee rows, no
  rank-1 slots. A non-mutating removal simulation improved holdout
  replay versus the current roster.

## Why Not The Larger 11-Filter Cut

The larger candidate list also included `heikin_ashi_reversion`,
`mad_reversion`, `donchian_reversion`, `hull_ma_position`, and
`tsi_meanrev`. I did not retire those in this pass.

Non-mutating committee/backtest simulations showed:

- Current post-config-sweep roster: 446 selections, 1,375 scored,
  58.18% WR, `$4,500` PnL.
- Drop the five weak Tier-B filters only: 429 selections, 1,366 scored,
  58.35% WR, `$4,560` PnL.
- Drop all six filters in this prune: 428 selections, 1,369 scored,
  58.58% WR, `$4,700` PnL.
- Drop the full 11-filter proposal: 409 selections, 1,273 scored,
  57.74% WR, `$3,940` PnL.

The broad mechanism-duplicate cut was too aggressive; it reduced useful
coverage and hurt replay quality.

## Validation

Commands:

```sh
bun --print 'import "@alea/lib/filters/all"; const { allCandidates, allFilters } = await import("@alea/lib/filters/registry"); console.log(allFilters().length, allCandidates().length);'
bun alea committee:select
bun alea backtest:run
```

Results:

- Active registry: 29 filters / 246 candidates.
- Active training coverage: 2,460 `filter_runs` rows, matching
  246 candidates x 2 periods x 5 assets.
- Rebuilt committee roster: 428 rows.
- Retired-filter committee rows after rebuild: 0.
- Persisted backtest run `4`: 1,612 committee decisions, 1,369 scored
  trades, 58.58% WR, `$4,700` PnL at `$20` stake.
- Prior run `3`: 1,618 committee decisions, 1,375 scored trades,
  58.18% WR, `$4,500` PnL.
