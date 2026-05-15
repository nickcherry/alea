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

## Current Adopted Defaults

Selection:

```text
minEngagements = 80
minAggregateWinRate = 0.538
minWorstQuarterWinRate = 0.52
worstQuarterMinEngagements = 40
topN = 12
ruleOverrides = []
```

Voting:

```text
maxVotesPerFilter = 1
minVotesToTrade = 2
minConsensusFraction = 0.50
```

A follow-up vote-shape sweep tested whether the weaker `5m` BTC/SOL
slices could be restored without taking the full top-18 voter set. The
best production-simple default kept the same eligibility rules and
voting policy, tightened the selection cap to `topN = 12`, avoided
edge-weighted voting, and returned the no-flag market set to all six
BTC/ETH/SOL `5m` + `15m` slices.

## Frontier

| profile                                       | min votes |     WR | scored |       PnL | read                                         |
| --------------------------------------------- | --------: | -----: | -----: | --------: | -------------------------------------------- |
| Adopted no-override top12                     |         2 | 58.66% |  2,719 |  `$9,420` | Best balanced all-surface default            |
| Prior no-override top18                       |         2 | 57.26% |  3,479 | `$10,100` | Highest raw PnL, weaker WR and weak 5m tails |
| Prior narrow-market top18                     |         2 | 58.42% |  2,689 |  `$9,060` | Strong WR, removed 5m BTC/SOL entirely       |
| Override profile, base 55%, worstQ 50%, top24 |         3 | 59.28% |  1,746 |  `$6,480` | Best high-WR lane, lower PnL                 |
| Current after weak-filter prune               |         3 | 58.58% |  1,369 |  `$4,700` | Pre-sweep baseline                           |

## Adopted Follow-Up Profile Breakdown

With `minVotesToTrade = 2`:

| slice |     WR | scored |      PnL |
| ----- | -----: | -----: | -------: |
| All   | 58.66% |  2,719 | `$9,420` |
| 5m    | 57.24% |  1,375 | `$3,980` |
| 15m   | 60.12% |  1,344 | `$5,440` |
| BTC   | 56.77% |    805 | `$2,180` |
| ETH   | 60.43% |  1,352 | `$5,640` |
| SOL   | 57.12% |    562 | `$1,600` |

## Rationale

The vote-only pass showed that `minVotesToTrade = 5` can print about
61% WR, but only on roughly 500 scored trades. That is too sparse for
the main default.

The high-WR selection cluster around a 55% aggregate WR floor and 50%
worst-quarter floor produced 59%+ WR, but lower trade count and lower
total PnL. It remains a possible selective mode.

The adopted profile removes the asset-specific overrides. After the
latest filter prune/config sweep, the no-override profile generalized
better across the current active filter set.

The follow-up top-12 cap trims the lower-ranked tail that made the
full all-surface top-18 profile noisy. It recovers most of the narrow
market profile's WR while adding back the `5m` BTC/SOL slices and
raising total proxy PnL.

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

After the follow-up default:

```sh
bun alea committee:select
bun alea backtest:run
```

Persisted run `7`:

- Committee roster: 366 rows.
- Committee decisions: 3,181.
- Scored trades: 2,719.
- Win rate: 58.66%.
- Proxy PnL: `$9,420` at `$20` stake.

Prior narrow-market run `6`:

- Committee roster: 507 rows.
- Committee decisions: 3,115.
- Scored trades: 2,689.
- Win rate: 58.42%.
- Proxy PnL: `$9,060` at `$20` stake.

Prior post-prune run `4`:

- Committee roster: 428 rows.
- Committee decisions: 1,612.
- Scored trades: 1,369.
- Win rate: 58.58%.
- Proxy PnL: `$4,700` at `$20` stake.
