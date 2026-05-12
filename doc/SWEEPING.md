# Committee Sweeping

Committee sweeping is the controlled search over trade committee
selection and voting settings. The goal is not to find a fragile
one-off winner. The goal is to find stable neighborhoods where win
rate improves while trade count stays useful.

The sweep uses the same holdout replay as `backtest:run`: historical
Pyth spot candles only, no Polymarket order book, no maker-fill model.
It does not mutate production constants and it does not rewrite the
live `committee_selections` roster.

## Objective

Primary objective: high win rate with enough trades to matter.

Ranking score:

```text
(wilson_lower_95(win_rate, scored_trades) - 0.50)
  * sqrt(min(scored_trades, 5000))
```

Hard filters before taking a result seriously:

- scored trades are not tiny
- win rate is above 50%
- PnL proxy is positive, which is implied by win rate above 50% at
  fixed stake
- positive days are not concentrated into one isolated burst

PnL is a sanity check, not the optimization target. At fixed notional
and no fees, win rate and scored trade count imply the proxy PnL.

## Command

```sh
bun alea backtest:sweep-committee
```

Useful options:

```sh
bun alea backtest:sweep-committee --max-runs 200
bun alea backtest:sweep-committee --max-runs 200 --telegram
bun alea backtest:sweep-committee --max-runs 20 --telegram --telegram-every 1
bun alea backtest:sweep-committee --mode focus --telegram
bun alea backtest:sweep-committee --mode fine --telegram
bun alea backtest:sweep-committee --mode ridge --telegram
bun alea backtest:sweep-committee --mode macro
```

The command writes a JSON artifact under `tmp/committee-sweeps/`.
With `--telegram`, it sends checkpoint updates, new-best updates, and a
final update. Use `--telegram-every 1` only for tiny debug sweeps.

`--mode broad` is the first pass across individual levers and coarse
crosses. `--mode focus` searches a tighter grid around the broad-pass
ridge. `--mode fine` is for a later pass around the best focused
neighborhood, including finer top-N and worst-quarter probes.
`--mode ridge` tests the current strict-stability and higher-volume
neighborhoods more densely after a promising cluster appears.
`--mode macro` deliberately skips micro-optimization and tests only
large moves: very strict candidate floors, much higher vote quorums,
near-unanimous consensus, and broad rosters.

## Selection Levers

These decide who is allowed onto the committee.

| Lever | Meaning |
| --- | --- |
| `minEngagements` | How many historical calls a candidate needs before we trust it at all. |
| `minAggregateWinRate` | Minimum overall win rate required to join the committee. |
| `minWorstQuarterWinRate` | Minimum win rate in the candidate's weakest meaningful quarter. This rejects one-period wonders. |
| `worstQuarterMinEngagements` | How many calls a quarter needs before it counts in the worst-quarter check. |
| `topN` | Maximum candidates kept per `(market regime, timeframe)` bucket. |
| ranking method | Sort qualified candidates by Wilson lower bound, then engagement count. This favors high WR but penalizes tiny samples. |

## Voting Levers

These decide whether the selected committee takes a trade.

| Lever | Meaning |
| --- | --- |
| `minVotesToTrade` | How many filter-collapsed committee votes must engage before trading. |
| `minConsensusFraction` | How much agreement the winning side needs. `0.60` means 60% of active votes must agree. |
| `maxVotesPerFilter` | How many active votes one filter may contribute. This should usually stay at `1` so one filter family cannot dominate. |
| filter tie-break | If multiple configs from the same filter vote, keep the one with higher selected-regime WR, then more engagements, then better rank. |

## Period Handling

The backtest and sweep both evaluate `5m` and `15m` separately. Results
carry:

- overall totals
- `byPeriod` totals for `5m` vs `15m`
- `byPeriodAsset` totals for period/asset pairs

Use the period breakdown to avoid overfitting one timeframe. A strong
setting should usually improve, or at least not damage, both `5m` and
`15m`. If a lever only helps one period, treat that as a hypothesis for
future per-period settings, not an automatic production win.

## Search Policy

Start broad, then deepen around clusters:

1. Run the baseline.
2. Sweep voting-only settings against the current selection rules.
3. Sweep one selection lever at a time.
4. Cross promising selection ranges with voting settings.
5. Prefer clusters of good neighboring configs over isolated winners.
6. Run the ridge mode once a cluster appears, then choose between the
   strict high-WR ridge and the higher-volume ridge using the period
   breakdown.
7. Use macro mode when the question is whether a materially different
   regime exists. Ignore anything that fails to move absolute win rate
   by at least one percentage point unless it dramatically increases
   trade volume without hurting win rate.

Cut the search off quickly when a config only wins by shrinking to tiny
trade volume, by concentrating in one day, or by helping one period
while hurting the other. Look deeper when win rate, trade count, and
period balance move together across adjacent settings.

Dense grids should be used to map a promising neighborhood, not as a
default operating mode. Once adjacent configs stop moving win rate by
meaningful amounts, stop the grid and compare the surviving clusters.
