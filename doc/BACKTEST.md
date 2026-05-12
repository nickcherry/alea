# Committee Backtest

The backtest is the fast holdout replay of the selected trade
committee. It simulates the same committee voting policy used by
dry-run/live trading over the post-training window, using historical
Pyth spot candles only. It does **not** connect to Polymarket, inspect
the order book, or model maker fills.

Run it:

```sh
bun alea backtest:run
```

Each run inserts one row into `committee_backtest_runs`. The `/backtest/`
dashboard reads the latest persisted row.

## Window

Window settings live in
[`src/constants/researchWindows.ts`](../src/constants/researchWindows.ts).
The backtest starts immediately after training:
`2026-04-01T00:00:00.000Z`, and ends at the start of the current UTC
day so it only scores complete candles through yesterday.

The replay may load pre-window candles only as indicator/regime warmup
context. A trade outcome only counts when the target candle's open time
is inside the backtest window.

## Scoring

At each historical decision moment, the runner:

1. Builds the trailing candle window for the asset/period.
2. Classifies the current market regime.
3. Loads the selected committee roster for `(regime, period)`.
4. Runs `evaluateCommittee`, including the shared one-vote-per-filter
   and consensus policy.
5. Scores non-abstain decisions against the target candle's
   open-to-close direction.

Tiny Pyth open-to-close moves use the same ambiguous-outcome helper as
training. Ambiguous target candles are counted as committee decisions
but excluded from win/loss and PnL proxy totals.

PnL proxy is `(wins - losses) * STAKE_USD`, assuming 50c maker entries,
zero fees, and 1:1 risk/reward. The dashboard shows the notional order
size and scored notional next to the proxy so large totals are traceable
to either order size or trade count. It also stores and renders a daily
cumulative PnL curve for the latest run. This remains an execution-free
quality measure; order placement belongs to dry-run/live.

## Files

- [`src/lib/backtest/runCommitteeBacktest.ts`](../src/lib/backtest/runCommitteeBacktest.ts) —
  holdout replay and persistence.
- [`src/bin/backtest/runCommittee.ts`](../src/bin/backtest/runCommittee.ts) —
  `backtest:run` CLI.
- [`src/lib/backtest/dashboard/`](../src/lib/backtest/dashboard/) —
  `/backtest/` payload + renderer for the latest persisted run.
- [`src/lib/db/migrations/202605121200_create_committee_backtest_runs.ts`](../src/lib/db/migrations/202605121200_create_committee_backtest_runs.ts) —
  persisted run table.
