# Filter Config Sweep 2026-05-15

## Scope

Swept active mean-reversion / fade config ladders after the redundancy
prune. The sweep artifact is local at:

`tmp/config-sweeps/filter-config-sweep-1778806682192.json`

The sweep evaluated 268 candidate configs across the standard
`period x asset` grid. Of those, 176 configs were new to the training
artifact cache; 920 run evaluations were cached and 1,760 were computed
fresh.

## Applied changes

The active registry remains 35 filters. Active candidate configs moved
from 310 after the redundancy prune to 299 after this config sweep.

Updated default config ladders:

- `balance_of_power_meanrev`: 9 configs
- `bollinger_percent_b`: 9 configs
- `bollinger_reversion`: 9 configs
- `cci_meanrev`: 8 configs
- `dema_bollinger_reversion`: 7 configs
- `internal_bar_strength_meanrev`: 9 configs
- `low_volume_breakout_fade`: 9 configs
- `percent_rank_meanrev`: 6 configs
- `rsi_meanrev`: 7 configs
- `stdev_channel_reversion`: 8 configs
- `stochastic_meanrev`: 9 configs
- `streak_fade`: 5 configs
- `tsi_meanrev`: 7 configs

The raw top-ranked sweep row was a `bollinger_percent_b` extreme with
only 179 engagements. I did not promote that tiny-sample config into the
registry. The selected ladders favor stronger sample size and repeated
performance across assets/quarters over a single small high-WR outlier.

Notable robust rows retained:

- `balance_of_power_meanrev` `{ length: 5, threshold: 0.55 }`, 15m:
  3,031 engagements, 58.6% WR, 56.8% Wilson lower bound.
- `low_volume_breakout_fade`
  `{ lookback: 14, volLength: 20, maxRelVol: 0.7, atrLength: 7, minBreakAtr: 0, minCloseBeyondAtr: 0 }`,
  15m: 4,392 engagements, 57.4% WR, 55.9% Wilson lower bound.
- `streak_fade` `{ minStreak: 5 }`, 15m: 9,021 engagements,
  57.0% WR, 56.0% Wilson lower bound.
- `stochastic_meanrev`
  `{ lookback: 14, smoothK: 1, oversold: 5, overbought: 95 }`, 15m:
  19,920 engagements, 56.3% WR, 55.6% Wilson lower bound.
- `internal_bar_strength_meanrev`
  `{ ibsLength: 4, lower: 0.15, upper: 0.85, atrLength: 14, minRangeAtr: 0.2 }`,
  15m: 3,847 engagements, 57.7% WR, 56.1% Wilson lower bound.

## Validation

Commands:

```sh
bun --print 'import "@alea/lib/filters/all"; const { allCandidates, allFilters } = await import("@alea/lib/filters/registry"); console.log(allFilters().length, allCandidates().length);'
bun x --bun eslint src/lib/filters/balanceOfPowerMeanrev.ts src/lib/filters/bollingerPercentB.ts src/lib/filters/bollingerReversion.ts src/lib/filters/cciMeanRev.ts src/lib/filters/demaBollingerReversion.ts src/lib/filters/internalBarStrengthMeanrev.ts src/lib/filters/lowVolumeBreakoutFade.ts src/lib/filters/percentRankMeanRev.ts src/lib/filters/rsiMeanRev.ts src/lib/filters/stdevChannelReversion.ts src/lib/filters/stochasticMeanRev.ts src/lib/filters/streakFade.ts src/lib/filters/tsiMeanRev.ts
bun run typecheck
bun alea training:run --filters balance_of_power_meanrev,bollinger_percent_b,bollinger_reversion,cci_meanrev,dema_bollinger_reversion,internal_bar_strength_meanrev,low_volume_breakout_fade,percent_rank_meanrev,rsi_meanrev,stdev_channel_reversion,stochastic_meanrev,streak_fade,tsi_meanrev
bun alea committee:select
bun alea backtest:run
```

Results:

- Registry import: 35 filters, 299 active candidates.
- Training coverage: 102 swept active configs across 2 periods and
  5 assets; rows were cached/present for the active configs.
- Committee selection: 446 rows in `committee_selections`.
- Backtest run `3`: 1,618 committee decisions, 1,375 scored trades,
  58.18% WR, `$4,500` PnL at `$20` stake.

Prior comparable v4 run `2` had 1,496 committee decisions,
1,295 scored trades, 57.53% WR, and `$3,900` PnL. The config sweep is
therefore a net improvement on holdout WR, scored trade count, and PnL
while using fewer active configs.
