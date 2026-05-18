# Dry Run

The dry-run loop is the rehearsal path for live trading. It runs the same
candidate-filter decision path as `trading:run`, but simulates the configured
Polymarket maker order instead of placing a real order.

Run:

```sh
bun alea dry:run
```

The process stays up until SIGINT / SIGTERM.

## Decision Flow

1. Hydrate recent Pyth spot candles for each configured asset/period.
2. Ten minutes before the current `1h` target candle closes, refresh recent
   Pyth candles and synthesize the current-hour candle from the latest Pyth
   price.
3. Evaluate the candidates registered for that candle period in
   `src/lib/filters/registry.ts`.
4. Persist only actionable up/down majorities to `dry_run_decisions`.
5. Simulate the current-market Polymarket order and score the outcome once the
   target Pyth candle is closed.

The supported trading period is `1h`. Decision timing comes from
`tradeDecisionLeadTimeMs({ period })`, currently 10 minutes before the hourly
market closes.

## Persistence

`dry_run_decisions` is append-only for actionable dry-run decisions. Important
columns:

| Column                               | Meaning                                                 |
| ------------------------------------ | ------------------------------------------------------- |
| `ts_ms`                              | Target candle open time in milliseconds                 |
| `decided_at_ms`                      | Wall-clock time when filters ran                        |
| `asset`, `period`                    | Market bucket                                           |
| `prediction`                         | `u` or `d`, the side dry-run would buy                  |
| `synth_open`                         | Decision-time synthetic price used as the live reference |
| `decision_audit`                     | JSON filter vote audit, including candidate votes       |
| `actual_open`, `actual_close`, `won` | Filled after the target candle settles                  |

`dry_run_decision_attempts` records every scheduled evaluation, including
neutral/no-trade filter majorities. The linked `dry_run_decision_id` is null
when no actionable row was written.

## Dashboard

The dry-run dashboard reads `dry_run_decisions` at build time and renders under
`/dryrun/`. It shows the active decision constants, per-asset win rates,
cumulative win rate, and recent decisions for the active `1h` period.

Build locally:

```sh
bun alea dashboards:build --only dryrun
```

## Key Code

- `src/lib/dryRun/runDryRun.ts` — scheduler, filter evaluation, persistence,
  and outcome scoring.
- `src/lib/filters/registry.ts` — active candidate registry.
- `src/lib/tradeDecision/candleState.ts` — shared hydrate/refresh/synthesize
  candle state for dry-run and live trading.
- `src/lib/dryRun/orderSimulation.ts` — current-market order placement and fill
  simulation.
