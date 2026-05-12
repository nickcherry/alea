# Round 2 Price-Only Filter Prune 2026-05-12

Scope: post-backtest cleanup of the round-2 OHLC-only filter batch. Implementations remain in `src/lib/filters/`; this pass only changes active registration/config coverage.

## Retired From Active Registration

These families were sub-50 aggregate win rate on both 5m and 15m, had no committee selections, and showed no strong enough near-term reason to keep spending active candidate slots:

- `adx_di_trend_follow`
- `efficiency_ratio_continuation`
- `ema_pullback_trend_follow`
- `fractal_breakout_follow`
- `higher_lows_lower_highs_follow`
- `inside_bar_breakout_follow`
- `macd_signal_cross_follow`
- `narrow_range_breakout_follow`
- `parabolic_sar_flip_follow`
- `strong_body_close_follow`
- `supertrend_flip_follow`
- `variance_ratio_trend_follow`

## Kept Despite Weak Aggregate

`squeeze_breakout_follow` remains active because it was selected by the regime committee for 5m `high_vol_trending` with 329 engagements and 61.7% win rate, despite poor all-regime aggregate performance.

## Further Config Exploration

Added tighter adjacent configs for:

- `body_climax_fade`: the best round-2 family; all initial configs were positive on both periods and one was selected.
- `adx_di_exhaustion_fade`: not selected yet, but the fast/extreme-spread variants were 53%+ on both periods and had strong range-regime pockets.
- `macd_histogram_turn_fade`: modest aggregate edge, especially 5m, with clear preference for histogram-turn fade over MACD-cross follow.

## Post-Prune Run

Validation:

- Active registry after edits: 47 filters / 249 candidates.
- Removed derived rows for the retired filters under `pyth-open-close-min-abs-move-pct-v1:0.02`: 600 `filter_runs` rows and 9,334,738 `filter_engagements` rows.
- Post-run active training rows: 2,490 `filter_runs` rows = 249 candidates x 2 periods x 5 assets.
- Deployed exploration dashboard: 498 rows / 47 filters / 0 retired-filter rows.
- Deployed committee dashboard: 80 rows / 19 filters.

Explored-family aggregate after adding configs:

| filter                     | period | configs | engagements | win rate |
| -------------------------- | -----: | ------: | ----------: | -------: |
| `body_climax_fade`         |    15m |      10 |     171,828 |   56.56% |
| `body_climax_fade`         |     5m |      10 |     287,084 |   53.66% |
| `adx_di_exhaustion_fade`   |    15m |      10 |     228,688 |   52.75% |
| `adx_di_exhaustion_fade`   |     5m |      10 |     360,510 |   53.17% |
| `macd_histogram_turn_fade` |    15m |      10 |     142,162 |   50.65% |
| `macd_histogram_turn_fade` |     5m |      10 |     222,226 |   51.71% |

Committee impact:

- `body_climax_fade` now has 3 selected rows in 15m `low_vol_trending`; 2 of those are from the newly added configs.
- `squeeze_breakout_follow` still keeps its 5m `high_vol_trending` slot.
- `adx_di_exhaustion_fade` and `macd_histogram_turn_fade` improved aggregate coverage but did not clear committee selection yet.
