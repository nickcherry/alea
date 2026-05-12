# Committee Structural Exploration - 2026-05-12

## Scope

This pass tested the next structural levers after asset-scoped committee
selection:

- per-asset and per-asset/timeframe selection thresholds
- high-vol regime-specific vote gates
- filter-family selection/vote collapse
- simple anti-reversion gating in high-vol regimes

The runs were transient holdout replays and did not mutate
`committee_selections` or production constants.

Artifacts:

- `tmp/committee-sweeps/structural-explore-smoke.json`
- `tmp/committee-sweeps/structural-explore-targeted-20260512.json`
- `tmp/committee-sweeps/structural-explore-needle-20260512.json`

Total completed trials: 313.

Baseline for comparison:

| Config | WR | Scored trades | 5m WR | 15m WR |
| --- | ---: | ---: | ---: | ---: |
| current asset-scoped defaults | 58.90% | 2,292 | 57.25% | 61.44% |

## Best Balanced Results

These are the most relevant results with at least 2,000 scored trades.

| Config | What changed | WR | Trades | 5m WR | 15m WR |
| --- | --- | ---: | ---: | ---: | ---: |
| `strong545_top9__hvt_off` | BTC/ETH selection loosened to 54.5% agg WR, top 9; abstain in high-vol trending | 60.07% | 2,141 | 59.41% | 60.78% |
| `strong55_weak5m__base` | BTC/ETH loosened to 55% agg WR, top 8; SOL/XRP/DOGE 5m tightened to 58% agg WR, top 4 | 59.88% | 2,034 | 59.46% | 60.26% |
| `strong55_doge_strict__hv_v3` | BTC/ETH loosened to 55% agg WR, top 8; DOGE tightened to 58% agg WR, top 4; require 3 votes in high-vol regimes | 59.87% | 2,016 | 59.22% | 60.62% |
| `baseline__hvt_v3` | Current selection; require 3 votes only in high-vol trending | 59.80% | 2,010 | 58.48% | 61.50% |
| `strong55_top8__hv_v3` | BTC/ETH loosened to 55% agg WR, top 8; require 3 votes in high-vol regimes | 59.58% | 2,187 | 58.68% | 60.64% |

The first row is the only clean >1pp WR improvement that still clears 2,000
trades. It is also the bluntest rule because it abstains from high-vol trending
entirely.

## Findings

High-vol trending is the most actionable weak slice. Current defaults get
53.64% WR there on 550 scored trades. Simply requiring 3 votes only in
high-vol trending lifts the current committee to 59.80% overall on 2,010 trades.
Fully abstaining in high-vol trending gets 60.56%, but falls to 1,742 trades.

BTC/ETH can carry more volume. Loosening only BTC/ETH selection is useful when
paired with high-vol gating. The best version found was BTC/ETH `minAggregateWR`
54.5%, `topN=9`, with high-vol trending abstained: 60.07% on 2,141 trades.
Loosening too much turns into volume without enough WR lift; e.g. BTC/ETH
54% / top 10 with high-vol voting gates produced 3,019 trades but only 58.76%.

Weak-asset 5m tightening is real but narrow. Tightening SOL/XRP/DOGE only on
5m to 58% / top 4 produced 59.88% on 2,034 trades with no special vote policy.
That is almost exactly a +1pp improvement and is less blunt than a regime
abstain rule.

DOGE is a useful specific lever. Tightening DOGE to 58% / top 4 produced
59.25% on 2,130 trades by itself. Combining DOGE strictness with BTC/ETH
looser selection and high-vol vote gates produced 59.87% on 2,016 trades.

XRP strictness raises WR but usually cuts below the 2,000-trade floor. XRP-only
strict selection produced about 60% WR but typically 1,800-ish trades. XRP 5m
strictness helped, but less than weak-asset 5m strictness as a group.

Family-level collapse did not work. Runtime family vote collapse reduced the
baseline to 57.98% on 1,428 trades. Selecting only one filter per family also
hurt: 56.67% on 1,514 trades. The current one-vote-per-filter rule is doing the
right kind of de-duplication; collapsing the broader family layer throws away
too much useful independent signal.

Anti-reversion in high-vol trending mostly behaved like abstaining from
high-vol trending, because the selected high-vol-trending voters are heavily
reversion/fade dominated. It improved WR but usually cut volume below 2,000.

## Recommendation

I would not pursue family collapse further right now.

The two serious next candidates are:

1. Conservative: per-asset/timeframe selection rules, specifically BTC/ETH
   looser plus weak-asset 5m stricter. This reached 59.88% on 2,034 trades
   without adding a new no-trade regime.
2. Aggressive: abstain in high-vol trending while slightly widening BTC/ETH
   selection. This reached 60.07% on 2,141 trades, but should get a weekly
   stability check before becoming live behavior because it is a blunt regime
   exclusion.

If we implement one next, I would start with conditional selection rules rather
than family collapse. It is the cleaner architecture for asset-specific
committees and gives us a natural place to encode per-asset/per-timeframe
thresholds without maintaining a parallel old system.
