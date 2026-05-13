# Regime Paradigm Exploration - 2026-05-13

## Scope

Tested three replacement regime classifiers. Each paradigm was applied as the
real `classifyMarketRegime` implementation, then the downstream stack was
re-materialized:

1. `bun alea regimes:backfill`
2. `bun alea training:run`
3. `bun alea committee:select`
4. `bun alea backtest:run`

`training:run` completed from the exact-profile cache because candles, filters,
and outcome labels were unchanged. Regime changes affect `bar_regimes` and
committee selection, not raw filter engagement generation.

After the tests, the classifier and DB were restored to the current default
linreg/realized-vol regime model. The restored default backtest is run `12`.

## Results

| Paradigm | Run | WR | Scored trades | 5m WR | 15m WR | Takeaway |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Restored default: realized-vol ratio + linreg trend strength | 12 | 59.67% | 2,090 | 59.07% | 60.20% | Keeper |
| Directional efficiency: ATR% expansion + net/path efficiency | 9 | 54.69% | 1,119 | 54.85% | 54.41% | Reject |
| Choppiness index: ATR% expansion + classic choppiness trend test | 10 | 56.56% | 1,837 | 55.88% | 58.03% | Reject |
| Donchian position: range expansion + close near range edge | 11 | 54.19% | 740 | 52.36% | 58.77% | Reject |

## Regime Distributions

| Paradigm | Low-vol trending | Low-vol ranging | High-vol trending | High-vol ranging |
| --- | ---: | ---: | ---: | ---: |
| Restored default | 730,920 | 324,036 | 237,935 | 70,079 |
| Directional efficiency | 149,281 | 912,882 | 81,882 | 218,925 |
| Choppiness index | 550,420 | 497,400 | 225,711 | 89,439 |
| Donchian position | 280,901 | 674,087 | 163,333 | 244,649 |

## Notes

Directional efficiency was the most structurally different, but it stranded too
much of the trend surface. The committee ended up with many empty or thin trend
buckets and the high-vol-ranging slice went sub-50%.

Choppiness index produced a plausible regime distribution, but the backtest
still gave back more than three points of win rate versus default. It also made
both high-vol regimes bad: high-vol-ranging 48.89%, high-vol-trending 48.15%.

Donchian position generated very confident training committees, but holdout
volume collapsed and 5m performance fell to 52.36%. This looks like classic
training over-selection on range-edge signals rather than a robust regime
definition.

## Conclusion

Do not replace the current regime classifier with any of these paradigms.

The current realized-vol + linreg-trend classifier remains the best tested
default. The more promising next lever is not a wholesale regime paradigm
replacement; it is conditional voting inside the current high-vol-trending
bucket, as noted in
[`next-suggestion-high-vol-trending-gate-2026-05-13.md`](./next-suggestion-high-vol-trending-gate-2026-05-13.md).
