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
