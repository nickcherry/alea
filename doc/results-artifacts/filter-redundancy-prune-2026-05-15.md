# Filter Redundancy Prune 2026-05-15

Scope: remove redundant or weak filters from active registration after reviewing the current active registry, training artifacts, co-engagement overlap, quarter robustness, asset spread, and committee selections. Implementations remain in `src/lib/filters/` for possible reactivation.

## Retired From Active Registration

Redundant filters:

- `zscore_reversion` — equivalent to the Bollinger distance test at matching length/threshold. Best row matched `bollinger_reversion` exactly: 5m, 546 engagements, 60.99% WR, 56.83% Wilson. Kept `bollinger_reversion`.
- `williams_r_meanrev` — inverted Stochastic. Best row matched `stochastic_meanrev` exactly: 15m, 19,920 engagements, 56.44% WR, 55.75% Wilson, 8/8 positive quarters. Kept `stochastic_meanrev`.
- `disparity_index_reversion` — EMA-distance reversion with a percent threshold; 0.93-0.94 Jaccard overlap with `ema_position` and roughly 99.7% same-direction overlap. Kept `ema_position`.
- `sma_position` — same moving-average position decision tree as `ema_position`, with 0.94-0.97 Jaccard overlap and roughly 99% same-direction overlap. Kept `ema_position`.
- `range_expansion_fade` — one-bar volatility-burst fade overlapping `atr_burst_fade`; 0.49-0.55 Jaccard overlap with 100% same-direction overlap. Kept `atr_burst_fade`.
- `cmo_meanrev` — gain/loss oscillator reversion that overlaps RSI/TSI without better committee breadth or Wilson strength. Kept `rsi_meanrev` and `tsi_meanrev`.

Weak active holdouts:

- `volume_dryup_pullback_follow` — zero committee seats; aggregate WR below 50% on both 5m and 15m; best row Wilson 46.51%.
- `squeeze_breakout_follow` — only two committee seats, but weak aggregate evidence: 47.32% WR on 5m and 43.51% WR on 15m; best row 48.35% WR with 2/8 positive quarters.

## Pre-Prune Snapshot

- Active registry: 43 filters / 373 candidates.
- Active training artifacts: 3,730 `filter_runs` rows and 19,945,451 `filter_engagements` rows.
- Committee roster: 455 rows.

## Post-Prune Validation

- Active registry: 35 filters / 310 candidates.
- Active training artifact coverage: 3,100 `filter_runs` rows, matching 310 candidates x 2 periods x 5 assets.
- Rebuilt committee roster: 437 rows / 35 filters.
- Retired-filter committee rows after rebuild: 0.
- Validation run: `bun run typecheck`, focused filter/selection tests, focused ESLint on `src/lib/filters/all.ts`, and Prettier check on the touched files.
