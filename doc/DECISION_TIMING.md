# Decision Timing (READ THIS FIRST)

The single most important thing to understand before changing anything
that touches filters, backtests, dry-run, or live trading.

If you are an LLM reading this codebase for the first time: **misread
this section and your work will be invalid**. There is a partial
intra-hour synthetic candle in the code, and it is easy to assume the
synthetic represents the candle we're predicting. It does not.

## Why this matters

Alea trades Polymarket 1h crypto up/down markets exclusively with
**maker orders near 50c**. There are no Polymarket fees on settlement
for makers, so realized PnL is governed by win rate at a ~1:1 payoff.

Maker orders only fill at favorable prices when the market price is
still around 50c. The market is at ~50c roughly when the candle is
about to open or has just opened — direction is uncertain, two-sided
order flow lives near the midpoint. As the candle progresses and
direction reveals itself, market price walks toward 0 or 1, and a 50c
maker bid on the winning side gets bypassed. By the time the candle
is half over, the winners no longer fill at 50c at all (the bid is
already 0.80+); only the losers fill, because their direction is the
side whose price collapsed toward 50c from 1.00.

So **a filter that predicts well at HH:50 but is only evaluated then
is useless in production** — the trade was unreachable by the time
the prediction was confident. The whole point of the pipeline is to
make a prediction *before* the market is decided, place a maker order
near 50c, and let the order fill when the candle eventually moves
through it.

## The exact timing

Concrete example with the current 15-min lead time:

```
prior candle           "now" candle (in progress)      target candle (we predict)
[HH-1:00 ... HH:00]    [HH:00 ............ HH+1:00]   [HH+1:00 ........ HH+2:00]
                                          ^           ^
                                          |           |
                              decision fires here     target opens here
                              (HH:45, 45 min into     (HH+1:00, 15 min after
                               now, 15 min before      decision fires)
                               target opens)
```

- `target.open` = HH+1:00
- `decisionTsMs = target.open - leadTime` (HH:45 for 15-min lead)
- `now.open = target.open - period` (HH:00 for a 1h target)
- The "now" candle is currently in progress and **not closed yet** at
  decision time.

## What the filter sees at decision time

```
filter.evaluate({
  series: { pyth: [...fullyClosedPriorBars, syntheticNowBar] },
  ...
})
```

- `fullyClosedPriorBars`: every 1h Pyth bar that closed strictly before
  `now.open`. Real, complete bars.
- `syntheticNowBar`: a partial 1h bar built from 1m data between
  `now.open` and `decisionTsMs`:
  - `open` = first 1m open at or after `now.open` (≈ the now-hour's
    actual open price)
  - `close` = last 1m close at or before `decisionTsMs` (= price right
    at decision time)
  - `high` = max 1m high in that window
  - `low` = min 1m low in that window
  - `volume` = sum of 1m volumes in that window
- **The target candle does not exist at decision time.** Nothing about
  the target is on the filter's input. The filter's job is to predict
  the not-yet-existing target candle's direction from prior history
  plus a partial read of the candle currently underway.

This is *fundamentally* different from "we're 25 minutes into the
candle we're predicting." The synthetic bar is the candle *before* the
target, partway through its life — not the target candle.

## Outcome

The label we evaluate against in the backtest is the eventual direction
of the target candle (`target.close > target.open` ⇒ `up`, else `down`).
Outcome resolution happens on closed historical bars in the candle
database; nothing about the target leaks into the filter inputs.

## Lead time semantics

`tradeDecisionLeadTimeMs({ period })` returns "minutes before the
*open* of the candle we are predicting." A larger lead time means
the filter fires *earlier*, with less info from the in-progress now
candle. A smaller lead time means it fires later, closer to (but still
before) target open, with more "now" candle info.

`tradeDecisionFireTimeMs({ period, targetTsMs })` returns the
clock-time at which the decision fires for the given target. The
formula is:

```
fireTime = targetTsMs - leadTime
```

**Not** `targetTsMs + period - leadTime` (that would be "minutes before
close" semantics, which is what the codebase originally used and which
broke maker-order fillability in live trading).

## What this rules out

A filter whose trigger reads `bar.close > bar.open` on the last bar in
the input series **is reading the now-candle's partial direction**, not
the target candle's. That's fine; it's a legitimate predictor. What is
*not* fine is interpreting that as "the candle we are betting on is
already 25/60 done so synth direction is highly predictive of outcome."
The target candle has zero bars of data at decision time; any predictive
correlation between the partial-now and the target is a real
cross-candle signal (momentum carryover, regime persistence, etc.), not
a self-prediction tautology.

## Reference timing math

For the current canonical setup (period = `1h`, leadTime = 15 min):

| symbol | value |
|---|---|
| `period` | 60 min |
| `leadTime` | 15 min |
| `decisionTsMs - target.open` | -15 min |
| `decisionTsMs - now.open` | +45 min |
| `now` partial 1m window | `[now.open, decisionTsMs]`, ~45 min |
| `target` data available to filter | none |

If `leadTime` is ever bumped, all of `tradeDecisionFireTimeMs`,
`runCandidateBacktest`, `loadSweepTargets`, the dry-run loop, and the
live-trading loop pick it up automatically because they all read from
`tradeDecisionLeadTimeMs`. The backtest cache hash includes `leadTimeMs`
so cached results invalidate cleanly when the constant changes.

## Implementation checklist before changing decision timing

If you are about to touch anything that could affect decision timing,
verify:

- [ ] `tradeDecisionFireTimeMs` returns `targetTsMs - leadTime` (not
      `targetTsMs + period - leadTime`).
- [ ] In the backtest, the bar at `targetBar.openTimeMs` is the bar
      whose direction we are predicting; the filter never sees `targetBar`
      itself, only fully-closed bars *before* the now candle plus the
      synthetic of the now candle.
- [ ] The synthetic bar's open time is `target.open - period` (i.e. the
      open of the *now* candle), not `target.open`.
- [ ] The 1m window used to build the synthetic ends at `decisionTsMs`,
      not at `now.open + period - leadTime` or some other variant.
- [ ] The outcome label is `target.close > target.open` from the stored
      `targetBar`, with no synthetic data influencing it.
- [ ] CLI docstrings in `src/bin/research/*Sweep.ts` describe this
      timing correctly (don't say "10 minutes before close" or
      "HH:50" — say "N minutes before target opens" / "the now candle
      partway through its life"). Prefer deriving the literal minutes
      from `tradeDecisionLeadTimeMs({ period: "1h" })` so the doc
      stays accurate when the constant changes.
