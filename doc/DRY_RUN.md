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
2. Before each target candle opens, refresh recent Pyth candles and synthesize
   the active candle from the latest Pyth price.
3. Evaluate the candidates registered for that candle period in
   `src/lib/filters/registry.ts`.
4. Persist only actionable up/down majorities to `dry_run_decisions`.
5. Simulate the pre-open Polymarket order and score the outcome once the target
   Pyth candle is closed.

The supported trading periods are `5m` and `15m`. Decision lead times come from
`tradeDecisionLeadTimeMs({ period })`, currently `5m` at T-2m and `15m` at
T-3m.

## Persistence

`dry_run_decisions` is append-only for actionable dry-run decisions. Important
columns:

| Column                               | Meaning                                                 |
| ------------------------------------ | ------------------------------------------------------- |
| `ts_ms`                              | Target candle open time in milliseconds                 |
| `decided_at_ms`                      | Wall-clock time when filters ran                        |
| `asset`, `period`                    | Market bucket                                           |
| `prediction`                         | `u` or `d`, the side dry-run would buy                  |
| `synth_open`                         | Decision-time synthetic price used as target open proxy |
| `decision_audit`                     | JSON filter vote audit, including candidate votes       |
| `actual_open`, `actual_close`, `won` | Filled after the target candle settles                  |

`dry_run_decision_attempts` records every scheduled evaluation, including
neutral/no-trade filter majorities. The linked `dry_run_decision_id` is null
when no actionable row was written.

## Dashboard

The dry-run dashboard reads `dry_run_decisions` at build time and renders under
`/dryrun/`. It shows the active decision constants, per-asset win rates,
cumulative win rate, and recent decisions for the selected `5m` or `15m`
period.

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
- `src/lib/dryRun/orderSimulation.ts` — pre-open order placement and fill
  simulation.
