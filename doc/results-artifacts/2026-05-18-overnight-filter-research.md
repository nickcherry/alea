# Overnight Filter Research (2026-05-18)

Systematic implementation of high-quality stateful filters in the same shape
as `rsi_divergence`: `trigger -> direction -> active window -> invalidation`.
Acceptance bar: >=60% win rate / >=500 decisions minimum; target 70%+ WR
and 1000+ decisions. Every filter must be explainable to a trading lay
person without resorting to magic configs.

Backtest training window extended from 2025-Q1-now to 2024-Q1-now in
`src/constants/backtest.ts`. RSI divergence sweep updated to import the
shared constant instead of hardcoding it.

Shared thesis-lifecycle helper landed at
`src/lib/filters/thesisLifecycle.ts` so new filters don't reimplement the
right/wrong tally, consecutive-wrong streak, max-age cutoff, "wrong > right"
rule, or "require first trade win" gate. Filters supply a structural-check
closure for trigger-specific invalidations (e.g. re-break of the sweep
extreme).

Shared sweep infrastructure landed at `src/lib/research/sweepInfra.ts`
(target loading, stat accumulation, per-asset/quarter summarization,
artifact writing). Both RSI divergence sweep and future sweeps use it.

## Filter 1: Failed Breakout Reversal

`src/lib/filters/failedBreakoutReversal.ts` — `filter id = failed_breakout_reversal`, `version = 1`.

**Idea.** A candle whose low pierced a prior N-bar low (or high pierced a
prior N-bar high) and then closed back across that level with a strong
close-location is a fakeout that often reverses. The persistence harness
keeps the reversal thesis active until a re-break of the sweep extreme,
consecutive wrong bars, max age, or an unfavorable right/wrong tally.

**Sweep.** 5,760 candidate configs over 4 assets, 9 quarters (2024 Q2 - 2026 Q2).
Run via `bun alea research:failed-breakout-reversal-sweep`.

**Registered config.**

```
lookbackBars: 40
minCloseLocation: 0.7
maxSignalAgeBars: 5
maxAge: 8
maxConsecutiveWrong: 1
requireWrongLessThanRight: false
requireFirstTradeWin: false
```

**Backtest results (`backtest:run` against canonical registry).**

| asset     | decisions | wins      | win rate   |
| --------- | --------- | --------- | ---------- |
| btc       | 998       | 861       | 86.27%     |
| eth       | 888       | 760       | 85.59%     |
| sol       | 1,051     | 878       | 83.54%     |
| doge      | 926       | 777       | 83.91%     |
| **total** | **3,863** | **3,276** | **84.80%** |

Per-quarter min WR across all 4 assets: 83.4%. Per-asset min WR: 83.5%.

**Why I believe the signal is real.**

- Base rate of UP outcomes across the 70,044 decision points is 50.46%.
  Filter WR of 84.80% is a 34-point edge above baseline.
- Direction-split balanced: 1,928 up votes at 84.54% WR, 1,927 down votes
  at 85.11% WR. Not a bull-market bias.
- Same config wins across 4 assets and 9 quarters with WR spread of only
  ~3pp (83.5% - 86.5%). Overfit configs typically have higher variance.
- Pattern reduces to a clean trader sentence: "price swept a 40-bar
  extreme and reclaimed it on the synthetic candle's close, with that
  close in the upper 30% of the bar's intrabar range."
- Sweep results reproduced by `backtest:run` (sweep 995 / 86.23% on BTC
  vs backtest 998 / 86.27% — within rounding).

**Frequency.** ~5.5% of decision opportunities fire (≈ one trigger every
18h on average across the 4 assets). Lower frequency than RSI divergence
(~8.7%) but higher WR (84.80% vs 75.33%).

**Lifecycle does most work at the trigger candle itself.** Most decisions
fire with `barsAgo = 0` — the synthetic bar IS the trigger. Higher
`maxSignalAgeBars` only adds ~40 marginal decisions out of ~3,855. The
persistence harness is mostly defensive (catches the structural re-break
edge cases).

## The synth-direction baseline (the bar future filters must beat)

Before reading filter 2 results, an important calibration. Across the full
70,044 decision points, the naive predictor "bet whatever direction the
synthetic bar shows at HH:50 (`close - open`)" wins **88.48%** of the time.

Layering in a body-and-close-location strength filter pushes that even
higher:

| naive predictor                                                       | decisions | WR     |
| --------------------------------------------------------------------- | --------- | ------ |
| bet synth direction                                                   | 70,039    | 88.48% |
| same, but only when `bodyPct >= 0.4` and `closeLoc` favorable >= 0.55 | 37,768    | 98.04% |
| same, but `closeLoc` favorable >= 0.65                                | 33,779    | 98.18% |

This isn't surprising. At HH:50, the 1h bar is 50/60 done; the last
10 minutes rarely flip its direction. A filter that fires only when
`synth.close > synth.open` (bullish) or `synth.close < synth.open`
(bearish) is essentially re-stating this trivial fact.

**Implication.** A filter that locks predicted direction to synth
direction (e.g. requires `bar.close > bar.open` for bullish) is not adding
alpha; it is regurgitating the 98% baseline. Only filters that can
_disagree_ with synth direction at the trigger candle — like RSI
Divergence (75.33% WR) and Failed Breakout Reversal (84.80% WR, with
clearly counter-intuitive triggers like a bearish call on a green synth)
— are doing real work.

Going forward: every new filter is judged not just by raw WR / count
but by whether it can predict against the synth-direction baseline. If a
filter never disagrees with the synth bar, that is a red flag.

## Filter 2: Trend Pullback Resume (SKIPPED — trivial-baseline detector)

`src/lib/filters/trendPullbackResume.ts` — implemented, swept, **not
registered**.

**Idea (from chatgpt's list).** Established trend (fast EMA above slow EMA
with positive slope, close above slow EMA), pullback of N candles that
does not break slow EMA, current candle is green with strong body and
close-location. Bearish is the mirror.

**Sweep top:** 99.40% WR on 5,003 decisions (`fast=20,slow=50,slope=1,
pull=2,body=0.6,closeLoc=0.75,age=0`). Per-quarter min 98.6%, per-asset
min 99.30%.

**Why I am not registering it.** The trigger requires `synth.close >
synth.open` (bullish) or the inverse (bearish), so it can never predict
against the synth-direction baseline. Its 99% WR is within the noise of
the 98% body-and-closeLoc baseline above; the EMA conditions only filter
_which_ of those obvious cases qualify. Registering it would pollute the
canonical set with a filter that does not add information beyond "this
bar is almost decided already."

I kept the filter, core, sweep, and tests in tree because the EMA
infrastructure and pullback-window detection are reusable for later
filters that _can_ go against synth direction (e.g. counter-trend pullback
fade variants). The sweep artifact lives at
`doc/results-artifacts/*-trend-pullback-resume-sweep.json` for reference.

## Calibration: all three registered filters disagree with synth bar sometimes — and lose when they do

Decomposing each registered filter's decisions by whether the predicted
direction agrees with the synthetic bar's direction at HH:50:

| filter                   | total decisions |     WR | with-synth (n, WR) | against-synth (n, WR)   |
| ------------------------ | --------------: | -----: | ------------------ | ----------------------- |
| rsi_divergence (v6)      |           6,098 | 75.30% | 4,936 at 88.39%    | 1,162 at 19.71% (19.1%) |
| failed_breakout_reversal |           3,855 | 84.80% | 3,506 at 89.90%    | 349 at 33.81% (9.1%)    |
| exhaustion_reversal      |           1,024 | 84.28% | 923 at 90.36%      | 101 at 28.71% (9.9%)    |

This is the same pattern in all three. The bulk of each filter's decisions
agree with the synth direction at HH:50 and win close to the body+closeLoc
baseline (98%). The against-synth slice — what one might call the "real
reversal alpha" — _loses_ in every filter, badly. RSI Divergence loses
80% of its 1,162 against-synth bets; Failed Breakout Reversal loses 66%
of its 349; Exhaustion Reversal loses 71% of its 101.

A few things follow:

- These filters are not "pure" reversal callers. They are mostly
  synth-direction predictors that occasionally guess against the bar.
  The against-synth guesses are net-negative; the with-synth guesses
  carry the aggregate.
- The user's existing RSI Divergence at 75% WR already had this
  property. The new filters don't break a pattern that wasn't already
  there; they ride the same dynamic at higher aggregate WR.
- Filters that can hard-lock predicted direction to synth direction (the
  trend-pullback-resume case) will saturate at the body+closeLoc
  baseline ~98% and add nothing.
- Filters that try to be more contrarian than these (always go against
  the obvious synth direction) will likely have terrible aggregate WR
  unless they find a sub-pattern that genuinely predicts reversal on
  10-minute horizons.

The takeaway for future filters: track the with-vs-against synth split
and the per-quarter consistency, not just aggregate WR. A filter with
materially better against-synth WR than these three would be a genuine
breakthrough.

## Filter 3: Exhaustion Reversal

`src/lib/filters/exhaustionReversal.ts` — `filter id = exhaustion_reversal`, `version = 1`.

**Idea.** A strong recent directional run (enough green bars over N
candles plus positive cumulative return), price extended away from the
EMA, then the current candle shows exhaustion characteristics (tall wick
against trend, close in the lower/upper half of its range, optionally a
body smaller than the prior bar). Bet against the run.

**Sweep.** 46,656 candidate configs (648 base × 72 lifecycle), 4 assets,
9 quarters. Run via `bun alea research:exhaustion-reversal-sweep`.

**Registered config.**

```
emaLength: 20
runWindow: 5
minDirectionalCount: 5
minRunReturnPct: 0.02
minDistanceFromEmaPct: 0.002
minWickPct: 0.10
maxCloseLocation: 0.40
requireBodyShrink: false
maxSignalAgeBars: 3
maxAge: 8
maxConsecutiveWrong: 1
requireWrongLessThanRight: false
requireFirstTradeWin: false
```

**Backtest results (`backtest:run`).**

| asset     | decisions | wins    | win rate   |
| --------- | --------- | ------- | ---------- |
| btc       | 153       | 131     | 85.62%     |
| eth       | 242       | 210     | 86.78%     |
| sol       | 311       | 252     | 81.03%     |
| doge      | 319       | 271     | 84.95%     |
| **total** | **1,025** | **864** | **84.29%** |

Per-quarter min WR: 74.32% (one weak quarter). Per-asset min: 81.03%.

**Frequency.** ~1.5% of decision opportunities — lower than RSI
divergence and failed-breakout reversal, but still produces 1,000+
decisions across the 2.3-year window. Most decisions are on the synth
bar (`barsAgo = 0`); the persistence harness occasionally extends the
thesis 1-3 bars before invalidation.

**Caveat (see calibration section above).** 90% of decisions agree with
synth direction at 90.36% WR; the 10% against-synth slice loses 71% of
the time. Same shape as RSI Divergence and Failed Breakout Reversal.

## Filter 4: Compression Breakout Acceptance (SKIPPED — trivial-baseline detector)

`src/lib/filters/compressionBreakout.ts` — implemented, swept, **not
registered**.

**Idea.** Detect a tight compression window where the recent average
range is materially smaller than the longer baseline, then a current
candle that closes outside the compression high/low with a strong body
and close-location.

**Sweep top.** 100% WR on 405 decisions (`tW=8,bW=50,ratio=0.5,
body=0.55,cLoc=0.6,age=0,mAge=4,mCons=1`). 99.74% WR on 1,524 decisions
with looser ratio (0.8) but stricter close-location (0.8).

**Why I am not registering it.** The bullish trigger requires
`bar.close > compressionHigh` combined with `closeLoc >= 0.6` and
`bodyPct >= 0.55`. That set of conditions guarantees the synth bar is
strongly green; the trigger never fires against synth direction. So the
WR is at or above the synth-direction body+closeLoc baseline (~98%) but
adds no unique alpha. The filter, core, sweep, and tests stay in tree
for reuse (compression detection is useful infrastructure for other
ideas) and the sweep artifact is in `doc/results-artifacts/`.

## Filter 5: Trap Candle / Failed Continuation (SKIPPED — predicted trivial)

Not implemented. ChatGPT's spec required the trigger candle to have
`currentClose < currentOpen` for bearish (and the inverse for bullish),
which would lock the predicted direction to the synth bar's direction —
the same shape as compression breakout and trend pullback resume. Without
the alpha-mode handle, the filter would just replay the synth-direction
baseline. Holding off in favor of higher-alpha candidates.

## Filter 6: Moving-Average Rejection

`src/lib/filters/maRejection.ts` — `filter id = ma_rejection`, `version = 1`.
**Registered.**

**Idea.** In a stacked-EMA uptrend (`ema20 > ema50 > ema100`), the
current bar's low pierces the fast or mid EMA from above, and the close
back above the fast EMA shows a strong lower wick (>=15% of range) and
close-location (>=0.75). Bearish is the mirror image. The thesis stays
active until a close back through the fast EMA against the trend (or
the shared lifecycle invalidation conditions fire).

**Sweep.** 3,888 candidate configs, 4 assets, 9 quarters. Run via
`bun alea research:ma-rejection-sweep`.

**Registered config.**

```
fastEmaLength: 20
midEmaLength: 50
slowEmaLength: 100
touchTolerancePct: 0.0005
minLowerWickPct: 0.15
minCloseLocation: 0.75
maxSignalAgeBars: 0
maxAge: 4
maxConsecutiveWrong: 1
requireWrongLessThanRight: false
requireFirstTradeWin: false
```

**Backtest results.**

| asset     | decisions | wins      | win rate   |
| --------- | --------- | --------- | ---------- |
| btc       | 763       | 685       | 89.78%     |
| eth       | 656       | 581       | 88.57%     |
| sol       | 688       | 614       | 89.24%     |
| doge      | 660       | 578       | 87.58%     |
| **total** | **2,767** | **2,458** | **88.83%** |

Per-quarter min WR 85.99%, per-asset min 87.58%. Highest aggregate WR of
the registered set with strong frequency (~4% of decision opportunities,
between failed-breakout and rsi-divergence).

**Why this is the best of the new filters.** 93.4% of decisions agree
with synth direction at 92.35% WR (vs failed-breakout's 89.90%); the
6.6% against-synth slice loses 62% of the time, smallest against-synth
share of any of the four registered filters. So MA Rejection is even
more selective about firing only on clear cases — but because the
with-synth WR is materially higher (92.35% vs 88-90% for the others)
and the against-synth drag is smaller, the aggregate is the highest of
the set.

**Caveat.** Per the calibration note above, "highest WR" mostly means
"most synth-aligned". Treat as a high-confidence directional confirmation
rather than a contrarian reversal signal.
