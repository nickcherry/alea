# Filter Prune 2026-05-11

Scope: prune active default candidates from the May 2026 expansion pass after the first full pyth/spot backtest. Implementations are preserved in `src/lib/filters/` so they can be reactivated when the data source or evidence changes.

## Retired From Active Registration

Volume/VWAP candidates retired because the active Pyth training feed has zero volume, so every default config produced zero engagements:

- `low_volume_breakout_fade`
- `mfi_meanrev`
- `obv_divergence_reversal`
- `volume_climax_fade`
- `vwap_band_reclaim`
- `vwap_zscore_reversion`

Continuation/trend candidates retired because both 5m and 15m aggregate results were sub-50 win rate and none were selected by the regime committee:

- `adx_di_trend_follow`: 47.32% on 5m, 47.09% on 15m
- `efficiency_ratio_continuation`: 45.59% on 5m, 44.44% on 15m
- `inside_bar_breakout_follow`: 48.35% on 5m, 45.53% on 15m
- `narrow_range_breakout_follow`: 49.16% on 5m, 46.27% on 15m
- `parabolic_sar_flip_follow`: 48.98% on 5m, 47.49% on 15m
- `supertrend_flip_follow`: 45.96% on 5m, 42.56% on 15m

## Retired In Follow-Up

Follow-up operator prune removed three more active registrations. `alteration_range_flip` in the request maps to the registered `alternation_range_flip` id.

- `squeeze_breakout_follow`
- `alternation_range_flip`
- `choppiness_range_edge_fade`

The retired `squeeze_breakout_follow` config was:

```json
{
  "length": 20,
  "maxWidthPercentile": 10,
  "minBodyFraction": 0.5,
  "multiplier": 2,
  "widthLookback": 100
}
```

## Loader Guard

Dashboard and committee loaders now gate rows by the current active `(filter_id, filter_version, config_canon)` registry. This keeps stale `filter_runs` rows from resurfacing after a filter/config is pruned.

## Post-Prune Validation

- Active registry after follow-up: 38 filters, 189 default candidates.
- Active training cache after follow-up: 1,890 `filter_runs` rows, matching 189 candidates x 2 periods x 5 assets.
- Deployed exploration payload after follow-up: 378 aggregate rows, 0 retired-filter rows.
- Deployed committee payload after follow-up: 80 rows, 17 filters, 0 retired-filter rows.
