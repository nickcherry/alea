# Committee Sweep Robustness 2026-05-12

Scope: committee selection and voting-logic sweep over the post-training
committee replay. This is a holdout replay of committee trade decisions using
Pyth spot candles only. It does not model Polymarket order-book fills.

Source artifacts:

- `tmp/committee-sweeps/full-20260512T163940Z.json`
- `tmp/committee-sweeps/focus-20260512T165422Z.json`
- `tmp/committee-sweeps/fine-20260512T171001Z.json`
- `tmp/committee-sweeps/ridge-20260512T174018Z.json`
- `tmp/committee-sweeps/macro-20260512T190050Z.json`
- `tmp/committee-sweeps/stacked-20260512T190749Z.json`
- `tmp/committee-sweeps/robustness-finalists-20260512.json`

## Executive Read

The global committee selection/voting sweep found a real but bounded
improvement. Baseline was `55.02%` on `24,102` scored trades. The useful
winner band is roughly `56.96%` to `57.48%`, depending on how much trade count
we require.

The best main-strategy candidate is not an isolated point. It is a stable
cluster around:

- `minAggregateWinRate`: about `0.538` to `0.54`
- `minWorstQuarterWinRate`: `0.52`
- `topN`: `16` to `18`
- `minVotesToTrade`: `2`
- `minConsensusFraction`: `0.50`; unanimity did not materially help

Pushing vote quorum to `5+` can produce higher win rates, including `59%`
variants, but volume collapses. Treat those as possible selective-mode
settings, not as the main default.

## Finalist Summary

| config | thesis | win rate | pp vs baseline | scored trades | trade rate | selected candidates | positive trading days | top day share |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Baseline | current production-style selection and one-vote rule | 55.02% | - | 24,102 | 40.81% | 160 | 95.12% | 3.50% |
| Strict main | best usable WR cluster | 57.48% | +2.46pp | 7,188 | 11.57% | 99 | 87.80% | 3.60% |
| Middle-volume | best >=8k trade balance | 57.32% | +2.30pp | 8,738 | 14.12% | 106 | 87.80% | 3.70% |
| High-volume | best roughly 10k+ trade option | 56.96% | +1.94pp | 10,049 | 16.58% | 120 | 90.24% | 3.66% |
| Current high quorum | current roster with 5-vote quorum | 57.31% | +2.29pp | 4,788 | 7.74% | 160 | 87.80% | 4.57% |
| Selective stacked | middle committee with 5-vote quorum | 59.10% | +4.08pp | 1,626 | 2.55% | 106 | 80.49% | 4.18% |

Read: the strict and middle-volume configs are the real main-strategy
candidates. The selective stacked config is directionally interesting but too
sparse for a default policy.

## Period Split

| config | 5m WR / trades | 15m WR / trades | read |
| --- | ---: | ---: | --- |
| Baseline | 54.83% / 15,817 | 55.39% / 8,285 | weak on both |
| Strict main | 56.52% / 3,790 | 58.56% / 3,398 | improves both, bigger lift on 15m |
| Middle-volume | 56.41% / 4,322 | 58.22% / 4,416 | balanced trade count, same 15m strength |
| High-volume | 56.55% / 6,483 | 57.71% / 3,566 | best 5m volume while keeping 15m strong |
| Current high quorum | 56.94% / 3,221 | 58.07% / 1,567 | both improve, but 15m volume is thin |
| Selective stacked | 57.27% / 440 | 59.78% / 1,186 | mostly a sparse 15m effect |

Conclusion: the main candidates are not only a 15m artifact, but 15m carries a
lot of the extra edge. A future period-specific policy may be worthwhile, but
the same global settings are defensible for both periods.

## Asset Split

| config | BTC | ETH | SOL | XRP | DOGE |
| --- | ---: | ---: | ---: | ---: | ---: |
| Baseline | 54.83% / 5,192 | 56.37% / 5,221 | 54.04% / 5,574 | 54.71% / 5,546 | 55.47% / 2,569 |
| Strict main | 58.52% / 1,514 | 59.54% / 1,493 | 55.82% / 1,625 | 56.80% / 1,646 | 56.59% / 910 |
| Middle-volume | 58.02% / 1,851 | 59.18% / 1,830 | 55.97% / 1,967 | 56.60% / 1,938 | 56.77% / 1,152 |
| High-volume | 57.63% / 2,209 | 60.04% / 2,022 | 55.75% / 2,332 | 55.38% / 2,425 | 55.98% / 1,061 |
| Current high quorum | 60.51% / 1,018 | 59.70% / 1,010 | 55.29% / 1,134 | 55.47% / 1,116 | 54.71% / 510 |
| Selective stacked | 61.99% / 321 | 61.99% / 321 | 59.29% / 339 | 55.43% / 368 | 57.04% / 277 |

BTC and ETH carry the cleanest gains. SOL and XRP still improve versus baseline
under the main candidates, but by less. DOGE is lower-volume and not a major
driver either way.

## Regime Split

| config | low-vol trending | low-vol ranging | high-vol ranging | high-vol trending |
| --- | ---: | ---: | ---: | ---: |
| Baseline | 56.02% / 12,439 | 55.53% / 3,668 | 51.93% / 1,658 | 53.57% / 6,337 |
| Strict main | 59.19% / 3,102 | 59.47% / 1,177 | 52.40% / 626 | 55.54% / 2,283 |
| Middle-volume | 58.66% / 4,119 | 58.96% / 1,367 | 53.08% / 699 | 55.46% / 2,553 |
| High-volume | 57.86% / 5,859 | 59.40% / 904 | 53.69% / 393 | 54.82% / 2,893 |
| Current high quorum | 58.96% / 2,378 | 58.55% / 275 | 57.49% / 247 | 55.03% / 1,888 |
| Selective stacked | 61.07% / 953 | 58.97% / 234 | 52.33% / 172 | 56.55% / 267 |

The biggest, most robust improvement is in low-vol regimes. High-vol ranging is
still weak and low-volume in every main candidate. That is the clearest next
place to investigate if we want another material move: a regime-specific
abstain or higher-quorum policy for high-vol ranging.

## Concentration Check

The finalists do not look like single-day artifacts. The largest day by scored
trade count is only `3.5%` to `4.6%` of each finalist's trades. The main
candidates still have bad days, especially around April 5-7, but the result is
not explained by one or two outsized positive days.

Worst daily PnL checks:

| config | worst day | trades | WR | proxy PnL |
| --- | --- | ---: | ---: | ---: |
| Baseline | 2026-04-07 | 716 | 46.23% | -$1,080 |
| Strict main | 2026-04-05 | 241 | 43.98% | -$580 |
| Middle-volume | 2026-04-05 | 266 | 45.11% | -$520 |
| High-volume | 2026-04-05 | 300 | 47.00% | -$360 |
| Current high quorum | 2026-04-06 | 167 | 44.91% | -$340 |
| Selective stacked | 2026-04-27 | 45 | 35.56% | -$260 |

The strict/middle candidates reduce drawdown exposure largely by taking fewer
trades, not by eliminating bad days.

## Macro Sweep Findings

Large-lever tests covered:

- vote quorum: `2`, `3`, `4`, `5`, `6`, `8`, `10`
- consensus: `0.50`, `0.80`, `1.00`
- very strict candidate WR floors: `0.56`, `0.58`, `0.60`, `0.62`, `0.65`
- broad rosters: `top40`, `top80`

Findings:

- Consensus is not a major lever. Unanimity usually barely changes results or
  reduces volume without enough win-rate gain.
- Requiring `5` votes is a real quality lever, but it cuts volume hard.
- Requiring `8+` or `10` votes is generally too sparse or unstable.
- Candidate WR floors above `0.56` can print high WR on tiny samples, but do
  not hold up at useful volume.
- Very broad rosters plus high quorum can recover some volume, but did not beat
  the strict/middle selection clusters.

## Recommendation

For a main default, prefer the middle-volume config unless we decide `7k` trades
is enough:

```text
minAggregateWinRate = 0.538
minWorstQuarterWinRate = 0.52
minEngagements = 20
topN = 17
minVotesToTrade = 2
minConsensusFraction = 0.50
```

It gives most of the win-rate improvement of the strict winner while keeping
about `1,550` more trades. If we want maximum win rate with still-usable
volume, use the strict main config:

```text
minAggregateWinRate = 0.54
minWorstQuarterWinRate = 0.52
minEngagements = 80
topN = 16
minVotesToTrade = 2
minConsensusFraction = 0.50
```

Do not adopt the `59%` stacked configs as the default. They are better framed
as a separate very-selective mode because they only produce about `1.6k` scored
trades.

## Remaining Work

The global selection/voting sweep is mostly exhausted. The remaining
high-value questions are not more micro-sweeps:

- Test a regime-specific abstain or higher-quorum rule for high-vol ranging.
- Audit committee composition for the strict/middle configs to confirm the edge
  is not coming from a tiny set of correlated filter families.
- If desired, run an explicit period-specific policy test; the current global
  settings work for both periods, but 15m is clearly stronger.
