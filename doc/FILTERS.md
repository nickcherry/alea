# Filters

A filter is deterministic trading logic with a stable interface:

- `id`, `name`, and integer `version`
- `description`, written plainly enough to understand the market idea
- `sources`, currently defaulting to Pyth spot candles
- typed `config`
- `evaluate(context)` returning `{ decision }`, where `decision` is `up`,
  `down`, or `neutral`

A candidate is one filter plus one concrete config. Candidate identity is
`filter id + filter version + canonical config hash`, so cached and persisted
results change when either code version or config changes.

The active registry lives in `src/lib/filters/registry.ts`. Each filter owns
its precise config type and evaluation implementation under
`src/lib/filters/`. Runtime callers should evaluate candidates through
`evaluateCandidateTradeDecision` so dry-run, live trading, and backtests use
the same vote aggregation.

Pyth spot candles are the canonical input for now. Coinbase spot candles can
be added later as a volume-context source without changing the candidate
identity model.
