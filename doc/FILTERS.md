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

The active registry lives in `src/lib/filters/registry.ts`. It is market-aware:
`registeredCandidatesByMarket` can assign different research/backtest
candidates to each asset+period pair, and backtest callers resolve that set
with `registeredCandidatesForMarket({ asset, period })`. Asset routing belongs
in the registry rather than inside a filter config, so cache hashes continue to
represent filter behavior instead of market selection.

The current local registry intentionally contains RSI Divergence candidates
for every enabled asset and period. All use hidden divergences,
`maxSignalAgeBars: 20`, and agreement-tally invalidation; they sweep
`minAgreementScore` across `0`, `-1`, `-2`, `-3` and
`maxConsecutiveDisagreements` across `1`, `2`, `3`. Dry-run and live trading
use the same market registry through
`tradeCandidatesForMarket({ asset, period })`. This is not a committee: if the
candidate returns `up` or `down`, the runtime can act on that signal; if it
returns `neutral`, there is no opinion.

The RSI divergence filter matches TradingView's RSI Divergence Indicator logic:
RSI length `14`, close as the RSI source, pivot lookback left/right `5`, and
lookback range `5` to `60`. Regular and hidden bullish divergences vote `up`.
Regular and hidden bearish divergences vote `down`. `maxSignalAgeBars: 20`
means a divergence can fire if it was confirmed on the current synthetic candle
or within the previous 20 candles. If no divergence is inside that window, the
candidate returns `neutral`.

Agreement-tally invalidation makes an older divergence go neutral when the
candles after confirmation stop respecting the signal. A candle that agrees
with the signal adds `+1` to the tally: green candles agree with bullish
divergence and red candles agree with bearish divergence. A candle that
disagrees subtracts `1`. Exact flat candles are neutral and reset the
consecutive-disagreement streak. If the tally falls below `minAgreementScore`,
or if the streak reaches `maxConsecutiveDisagreements`, that divergence is
considered dead and the candidate returns `neutral`.

The shared RSI matching logic lives in
`src/lib/filters/rsiDivergenceCore.ts`. The agreement-tally invalidation lives
in `src/lib/filters/rsiDivergenceInvalidation.ts`, so the stale-signal rule can
change without duplicating the TradingView-style divergence calculation.

Pyth spot candles are the canonical input for now. Coinbase spot candles can
be added later as a volume-context source without changing the candidate
identity model.
