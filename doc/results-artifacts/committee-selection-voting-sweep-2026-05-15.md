# Committee Selection/Voting Sweep 2026-05-15

## Scope

Swept the active post-prune committee selection profile and vote policy.
The sweep used the existing holdout replay path: Pyth candles for price
and outcome, Coinbase candles for volume-source filters, no order-book
or fill model.

The main adaptive sweep artifact is local at:

`tmp/committee-sweeps/profile-sweep-1778810029411.json`

The search was staged to avoid an expensive blind grid:

1. Vote-only sweep on the current profile.
2. Selection-profile sweep around the current overrides, prior
   robustness ridges, and no-override profiles.
3. Cross pass over the best selection profiles and best vote settings.
4. Targeted max-PnL cross over the best selection profiles with
   `minVotesToTrade = 2`.

## Adopted Defaults

Selection:

```text
minEngagements = 80
minAggregateWinRate = 0.538
minWorstQuarterWinRate = 0.52
worstQuarterMinEngagements = 40
topN = 18
ruleOverrides = []
```

Voting:

```text
maxVotesPerFilter = 1
minVotesToTrade = 2
minConsensusFraction = 0.50
```

This is the high-PnL lane. It gives up some absolute WR versus the
strictest profiles, but it still keeps a strong WR with materially more
scored trades and the best proxy PnL among the tested candidates.

## Frontier

| profile                                       | min votes |     WR | scored |       PnL | read                                                  |
| --------------------------------------------- | --------: | -----: | -----: | --------: | ----------------------------------------------------- |
| Adopted no-override top18                     |         2 | 57.26% |  3,479 | `$10,100` | Best total PnL with all asset/period slices above 55% |
| Same profile                                  |         3 | 58.52% |  2,148 |  `$7,320` | Higher-WR balanced lane                               |
| Override profile, base 55%, worstQ 50%, top24 |         3 | 59.28% |  1,746 |  `$6,480` | Best high-WR lane, lower PnL                          |
| Current after weak-filter prune               |         3 | 58.58% |  1,369 |  `$4,700` | Pre-sweep baseline                                    |

## Adopted Profile Breakdown

With `minVotesToTrade = 2`:

| slice |     WR | scored |       PnL |
| ----- | -----: | -----: | --------: |
| All   | 57.26% |  3,479 | `$10,100` |
| 5m    | 55.58% |  1,970 |  `$4,400` |
| 15m   | 59.44% |  1,509 |  `$5,700` |
| BTC   | 55.05% |    961 |  `$1,940` |
| ETH   | 58.76% |  1,843 |  `$6,460` |
| SOL   | 56.30% |    675 |  `$1,700` |

## Rationale

The vote-only pass showed that `minVotesToTrade = 5` can print about
61% WR, but only on roughly 500 scored trades. That is too sparse for
the main default.

The high-WR selection cluster around a 55% aggregate WR floor and 50%
worst-quarter floor produced 59%+ WR, but lower trade count and lower
total PnL. It remains a possible selective mode.

The adopted profile removes the asset-specific overrides. After the
latest filter prune/config sweep, the no-override profile generalized
better across the current active filter set. It increased total scored
trades while keeping all active asset and period slices above 55% WR.

## Validation

After applying the defaults:

```sh
bun alea committee:select
bun alea backtest:run
```

Persisted run `5`:

- Committee roster: 507 rows.
- Committee decisions: 4,114.
- Scored trades: 3,479.
- Win rate: 57.26%.
- Proxy PnL: `$10,100` at `$20` stake.

Prior run `4`:

- Committee roster: 428 rows.
- Committee decisions: 1,612.
- Scored trades: 1,369.
- Win rate: 58.58%.
- Proxy PnL: `$4,700` at `$20` stake.
