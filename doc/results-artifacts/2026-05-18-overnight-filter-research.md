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
