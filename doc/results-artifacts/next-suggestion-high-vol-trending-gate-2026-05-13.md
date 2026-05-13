# Next Suggestion: High-Vol-Trending Gate

## Recommendation

The next structural change to test is a conditional voting gate for
`high_vol_trending`.

Proposed first variant:

- keep the new scoped selection defaults
- keep normal regimes at `minVotesToTrade = 2`
- require `minVotesToTrade = 3` only when regime is `high_vol_trending`

The more aggressive variant is to abstain in `high_vol_trending` entirely, but
that is too blunt to make the default without a stability pass.

## Why

The latest default selection change improved the real backtest to 59.70% WR on
2,082 scored trades, but the weakest remaining regime is still high-vol:

| Regime | WR | Trades |
| --- | ---: | ---: |
| low_vol_trending | 62.92% | 971 |
| low_vol_ranging | 59.00% | 500 |
| high_vol_ranging | 55.33% | 300 |
| high_vol_trending | 54.98% | 311 |

The structural sweep showed that high-vol-trending gating is a real lever:

| Variant | WR | Trades | Note |
| --- | ---: | ---: | --- |
| current asset-scoped baseline | 58.90% | 2,292 | prior default |
| baseline + `high_vol_trending` min votes 3 | 59.80% | 2,010 | clean vote-gate lift |
| baseline + no `high_vol_trending` trades | 60.56% | 1,742 | higher WR, too much volume cut |
| BTC/ETH 54.5% top 9 + no `high_vol_trending` | 60.07% | 2,141 | best 2k+ exploratory result |

The cleanest next experiment is not to ban the regime outright. It is to ask
for one extra independent vote only when the market is high-vol trending.

## Stability Check Before Default

Before making this live, run a stability pass:

- weekly holdout buckets from 2026-04-01 through the current backtest end
- split by `5m` vs `15m`
- split by BTC/ETH vs SOL/XRP/DOGE
- compare against the current scoped selection default

Accept the gate only if the lift is clustered rather than carried by one week
or one asset.
