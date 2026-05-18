# Extension Reversal — first honest edge under corrected timing (2026-05-18)

After the decision-timing flip (see [DECISION_TIMING.md](../DECISION_TIMING.md)),
every previously registered filter collapsed to coin-flip. The legacy 70–92% WRs
were artifacts of the filter peeking at ~25–50 minutes of its own target
candle's partial. Under the correct setup (decision fires *before* target opens;
synth bar is the partial of the *prior* in-progress hour), all six filters lost
their edge.

This note documents the first signal that retains an edge under the corrected
timing: **Extension Reversal** — a mean-reversion bet against a compounded
extension across the synth bar and the most recent closed bar.

## Signal

At decision time `target.open - leadTime`, the filter inspects two bars:

- `lastClosed = bars[lastIndex - 1]` — the last fully-closed 1h Pyth bar
  (the bar before the in-progress "now" candle).
- `synth = bars[lastIndex]` — the synthetic partial of the in-progress
  "now" hour, built from 1m Pyth bars from `now.open` through
  `decisionTsMs`.

Trigger:

```
|synthReturnPct| >= minSynthReturnPct  AND
|lastReturnPct| >= minLastReturnPct    AND
sign(synthReturnPct) == sign(lastReturnPct)
```

Direction: bet **against** the extended direction. The further price has
already run inside the now-hour on top of an already-trending prior hour,
the more likely the *target* hour mean-reverts.

## Why this exists

1h crypto candles on Pyth spot exhibit a mild mean-reverting tendency over
short horizons when recent moves have been large. Run-ups draw in
short-term liquidity providers and exhaustion sellers; capitulations
attract dip buyers. The combined trigger (synth + last-closed both
extended in the same direction) selects for moments where momentum has
just been notably strong — exactly when reversals are common over the
next 1h candle.

The lead time matters. With the corrected 15-min lead, the filter sees
~45 minutes of "now-candle" 1m data in the synthetic bar — enough to
register a substantive intra-hour extension before the next hour opens.

## Sweep

Source: `bun alea research:extension-reversal-sweep`
([extensionReversalSweep.ts](../../src/bin/research/extensionReversalSweep.ts)).

Artifact:
[doc/results-artifacts/2026-05-18T13-36-38.739Z-one-hour-extension-reversal-sweep.json](2026-05-18T13-36-38.739Z-one-hour-extension-reversal-sweep.json).

Grid:

| dimension | values |
|---|---|
| `minSynthReturnPct` | 0.005, 0.01, 0.015, 0.02, 0.025 |
| `minLastReturnPct` | 0.005, 0.01, 0.015, 0.02 |
| `maxSignalAgeBars` | 0, 1, 2 |
| `maxAge` | 4, 8, 16 |
| `maxConsecutiveWrong` | 1, 2 |
| `requireWrongLessThanRight` | false, true |
| `requireFirstTradeWin` | false, true |

(2,880 candidates total. All 5 assets, 2024-01-01 → now.)

## Winning config

```
minSynthReturnPct: 0.02
minLastReturnPct:  0.01
maxSignalAgeBars:  0
maxAge:            4
maxConsecutiveWrong: 1
requireWrongLessThanRight: false
requireFirstTradeWin:     false
```

Registered in
[src/lib/filters/registry.ts](../../src/lib/filters/registry.ts) as
`extension_reversal@v1`. Source:
[src/lib/filters/extensionReversal.ts](../../src/lib/filters/extensionReversal.ts),
[src/lib/filters/extensionReversalCore.ts](../../src/lib/filters/extensionReversalCore.ts).

## Backtest results (corrected timing)

`bun alea backtest:run` against the canonical registry, all 5 assets,
2024-01-01 → 2026-05-18 (`CANDIDATE_BACKTEST_ENGINE_VERSION = 4`):

| asset | decisions | wins | win rate |
|---|---:|---:|---:|
| btc   |  19 |  12 | 63.16% |
| eth   |  58 |  34 | 58.62% |
| sol   |  96 |  54 | 56.25% |
| xrp   | 144 |  80 | 55.56% |
| doge  | 162 | 100 | 61.73% |
| **total** | **479** | **280** | **58.46%** |

Per-asset minimum: SOL at 56.25%. Per-quarter coverage: 8 of 9 covered
quarters positive (2024 Q3 the lone negative at 44%, 50 decisions).
Recent quarters: 2025 Q2 70.7%, 2025 Q3 65.2%, 2025 Q4 55.1%, 2026 Q1
53.9%. The recent slope is downward but still above 50%; worth
monitoring whether the edge persists in 2026.

## Caveats / open questions

- 479 decisions over ~2.4 years is moderate volume. The edge is more
  visible on DOGE/SOL/XRP (which trigger more often) than BTC/ETH (which
  rarely move 2%+ in 45 minutes plus another 1%+ in the prior hour).
- The signal is *exclusively* mean-reversion. Combined with the
  existing trend-following filters in the committee (RSI divergence,
  HTF alignment, etc.), they should have non-overlapping
  triggers — confirm before committing capital that the committee
  vote logic handles "one filter says up, one says down" correctly
  (current behavior: neutralize on conflict).
- We haven't tested whether tightening the synth threshold further
  (e.g. 0.025+) keeps the WR up at lower decision volume — the sweep's
  `minSynthReturnPct=0.025, minLastReturnPct=0.01` config showed 59.74%
  on 308 decisions, marginally higher WR but ~35% less volume. Worth
  revisiting if the registered config underperforms live.
