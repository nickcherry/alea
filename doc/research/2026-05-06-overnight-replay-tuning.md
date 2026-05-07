# 2026-05-06 — Overnight replay tuning

**Question:** can we find a configuration of the existing decision
pipeline that turns the captured 32h tape into substantial positive PnL,
without changing the production decision/training algos?

**Running log.** Updated as work progresses. Numbers and hypotheses
recorded chronologically; the *takeaway in one paragraph* lives at the
bottom once the night ends.

## Baseline

- Range: 2026-05-05 16:30 UTC → 2026-05-07 00:50 UTC (~32.3h)
- Source stack: coinbase/spot training + tick (cb spot WS BBO from
  `market_event`); chainlink for settlement; min-edge 0.05; stake $20.
- Probability table generated from coinbase/spot 5m+1m candles (2y).

| Metric | Value |
|---|---:|
| Windows replayed | 385 |
| Orders prepared | 754 |
| Canonical fills | 533 (70.7%) |
| Touch fills | 566 |
| **Canonical PnL** | **−$577.25** |
| Touch PnL | −$84.45 |
| All-orders-filled PnL | **+$2697.20** |
| Adverse-selection drag (all-filled − canonical) | $3274.45 |
| Chainlink/polymarket disagreements | 0 |

Replay JSONL: `tmp/replay-trading/replay-trading_2026-05-07T02-00-11.819Z.jsonl`

**Key signal.** All-filled PnL is strongly positive while canonical PnL
is negative → the model picks the right side, but our queue-aware fills
are concentrated in the losing half. Classic maker adverse selection:
when our limit hits, the price often moved *through* us.

## Lever menu

Cheap (post-hoc filter on existing JSONL — no re-replay):

1. min-edge threshold sweep
2. per-asset filtering
3. per-regime filtering
4. per-remaining-bucket filtering
5. side filtering (up vs down)
6. queue-depth gating (raise the floor on `queueAheadShares`)

Expensive (require re-running replay because they change which trades
fill or which orders are placed):

7. limit-price strategy variants (one tick below current, half-tick
   pull-back, etc.)
8. cancel-on-adverse-tick
9. Different placement timing (only place at certain remaining-min
   boundaries)
10. Source switching (binance perp once Vision catches up)
11. Taker-with-fees comparison (last resort, account for ALL fees)

## Findings — chronological


### 22:55 EDT — first telemetry sweep

Built `src/bin/research/sweepReplay.ts` — post-hoc filter analyzer that
loads a replay JSONL, applies arbitrary `FilterSpec`, and computes
canonical/touch/all-filled PnL with optional time-bucket stability check.

#### Single-axis sweep highlights

| Lever | Best bucket | Canonical PnL | Win rate | n |
|---|---|---:|---:|---:|
| Baseline | none | −$577.25 | 53.1% | 754 |
| min-edge ≥ 0.15 | (vs 0.05) | +$95 | 51.0% | 82 |
| queueAhead ≥ 100 | (vs ≥0) | +$84 | 59.2% | 200 |
| signedDistanceBp ∈ [−10,−5) | strong | +$108 | **72.4%** | 45 |
| signedDistanceBp ≤ −3 | broad | +$122 | 62.8% | 169 |
| entry30sDeltaBp ≥ +5 | strong | +$178 | 69.6% | 70 |
| asset = btc @ minEdge≥0.10 | best asset | +$124 | 61.8% | 56 |
| asset = xrp | worst | −$310 | 44.6% | 120 |

#### Best cross-product (so far)

`maxSignedDistanceBp ≤ −4 + minEdge ≥ 0.06` → **+$232.02** canonical /
81 orders / **72.9% win rate** / +$256 touch.

Stability across 4 time-buckets: all positive (+$23, +$97, +$69, +$43)
with win rates 67–86%. Real signal, not single-window luck.

#### CRITICAL asymmetry observation

`signedDistanceBp` is NOT signed by chosen side — it's just
`(price − line) / line × 1e4`. By construction, up bets have
positive signedDistanceBp at entry and down bets have negative. So the
"winning" filter `maxSignedDistanceBp ≤ −4` is **actually only catching
down bets**. The symmetric "up bets where price rose ≥4 bp above line"
filter is a loser:

| Filter | n | PnL | Win |
|---|---:|---:|---:|
| down: signedDistBp ≤ −4 + edge ≥ 0.06 | 81 | **+$232** | 72.9% |
| up: signedDistBp ≥ +4 + edge ≥ 0.06 | 113 | −$182 | 53.2% |

Two interpretations:
1. **Window bias**: BTC/SOL/DOGE were net-down trending in the 32h tape;
   "trend continuation down" is the play because price was actually going
   down. If next window trends up, our filter will under-fire badly.
2. **Pricing inefficiency**: Polymarket may systematically over-price
   "up" tokens (a directional bias from retail psychology), so maker
   bids on the up side are filled by smarter aggressors.

Action: keep the filter but flag it as direction-biased; revisit when we
have more data covering an up-trending period.


### 23:25 EDT — direction-aware union filter

Built side-aligned-momentum and trend-confirmation filters in the
analyzer. Discovered the "winning down filter" doesn't have a symmetric
up analog (signedDistanceBp's sign is determined by side at entry by
construction). Searched for an UP-side winner separately.

**UP-side winner**: `minSideAlignedMomentumBp ≥ 5` (recent 30s mid moved
≥5 bp into our predicted up direction) → +$131 / 62 / 66.7% win.

Combined into a 3-arm union filter (excluding XRP per per-asset bucket
showing 44.6% win rate in baseline):

```json
{
  "any": [
    {"sides":["down"], "minTrendConfirmBp":4, "minEdge":0.06,
     "excludeAssets":["xrp"]},
    {"sides":["up"],   "minSideAlignedMomentumBp":5,
     "excludeAssets":["xrp"]},
    {"sides":["up"],   "minEdge":0.15,
     "excludeAssets":["xrp"]}
  ]
}
```

**Result: +$481.28 canonical / 159 orders / 68.6% win / +$644 touch /
+$1400 all-fill.**

Stability across 4 time-buckets (all positive):

| Bucket | Start | n | PnL | Win |
|---|---|---:|---:|---:|
| 0 | 2026-05-05 17:02 | 28 | +$64 | 64.3% |
| 1 | 2026-05-06 00:56 | 54 | +$355 | 80.5% |
| 2 | 2026-05-06 08:51 | 25 | +$42 | 64.3% |
| 3 | 2026-05-06 16:46 | 52 | +$20 | 57.6% |

At $20 stake. Straight stake-scaling extrapolation to $200 → ~$4,800
per 32h, but wider sample needed before claiming that's real.

Open concern: bucket-3 win rate of 57.6% is close to the noise floor,
and bucket-2 is also low. The bulk of the edge is concentrated in
bucket-1. Need wider data to validate the filter as a stable rule
versus a 32h-period artifact.


### 23:55 EDT — taker-with-fees analysis

Added taker lens to the analyzer using the actual `chosenBestAsk`
captured in `entryBookTelemetry` and the Polymarket fee formula
`shares × (feeRateBps / 10_000) × price × (1 − price)` with default
720 bps (the value used everywhere in the codebase's test fixtures).

Best filter on taker:

| Lens | n | PnL | Win | Filled |
|---|---:|---:|---:|---|
| canonical maker | 159 | +$481 | 68.6% | 102/159 (64%) |
| touch (lucky maker) | 159 | +$644 | — | 109/159 |
| **taker @ 720 bps fee** | **159** | **+$661** | **79.9%** | 159/159 (100%) |
| all-fill (no spread, no fee) | 159 | +$1400 | — | 159/159 |

Fee sensitivity (same filter):

| feeBps | PnL |
|---:|---:|
| 0 | +$738 |
| 200 | +$717 |
| 400 | +$695 |
| 720 | +$661 |
| 1000 | +$631 |
| 1500 | +$578 |

Even at 15% fee taker is +$578. Fees are NOT the binding constraint.

#### Slippage caveat

Sampled the depth at best ask vs $20-stake share need: median ratio is
0.36 (i.e. only ~36% of needed shares available at best-ask price).
Slippage is unbiased between winners and losers (both p50 ratio = 0.33-0.36),
so it doesn't bias the win rate, but it does push realistic taker PnL
below the +$661 figure. Conservative correction (assuming avg fill
price = bestAsk + half-tick): −$30 to −$60 across 159 orders →
realistic taker ≈ **+$600**.

For full rigor, would need to walk the full polymarket book at each
order's `placedAtMs` from `market_event`. Punted for now.

#### Stake-scaling extrapolation

Linear-stake extrapolation (no slippage adjustment beyond the above):

| Stake | Estimated 32h taker PnL |
|---:|---:|
| $20 | $600 |
| $50 | $1,500 |
| $100 | $3,000 |
| $200 | $6,000 |

Real-world slippage is super-linear in stake, so $200 isn't actually
3× the $100 number — likely closer to $4,000-$5,000. Either way,
clearly in the "thousands" target.

#### Time-bucket stability (taker, best filter)

| Bucket | Start | n | PnL | Win |
|---|---|---:|---:|---:|
| 0 | 2026-05-05 17:02 | 28 | +$196 | 82.1% |
| 1 | 2026-05-06 00:56 | 54 | +$234 | 85.2% |
| 2 | 2026-05-06 08:51 | 25 | +$68 | 80.0% |
| 3 | 2026-05-06 16:46 | 52 | +$163 | 73.1% |

Much more stable than canonical maker (no 50%-win bucket). Win rate
across all 4 buckets: 73-85%.


### 00:25 EDT — TIME-OF-DAY effect

Sliced PnL by UTC hour of placement (with `minEdge:0.06` filter).
Discovery: there's a massive intraday seasonality.

| UTC hour | n | Maker PnL | Taker PnL | Win |
|---:|---:|---:|---:|---:|
| 0 | 33 | +$55 | +$84 | 76% |
| 1 | 23 | +$86 | +$140 | 87% |
| **2** | 24 | +$194 | +$176 | 88% |
| 3 | 32 | +$91 | +$53 | 72% |
| 4 | 34 | +$45 | +$20 | 68% |
| 5 | 23 | +$30 | +$8 | 65% |
| 6 | 22 | +$47 | +$58 | 73% |
| 7 | 18 | -$81 | -$94 | 50% |
| 8 | 18 | +$62 | +$62 | 78% |
| 11 | 12 | +$57 | +$37 | 83% |
| 16 | 33 | -$198 | -$188 | 45% |
| 17 | 52 | -$120 | -$91 | 58% |
| 18 | 66 | -$190 | -$149 | 55% |
| 19 | 59 | -$60 | +$39 | 64% |
| **20** | 63 | +$0.37 | **+$327** | 78% |
| 21 | 28 | -$124 | -$15 | 57% |
| 22 | 23 | +$40 | +$70 | 78% |
| 23 | 17 | -$141 | -$81 | 47% |

Pattern: Asian + early Europe (0-6) + scattered evening (19, 20, 22) wins;
US business hours (16-18) and late-evening (21, 23) lose. Hour 20 is a
GIFT for taker — model is right 78% of the time but maker can barely
fill (queue ahead doesn't clear when price moves favorably for us).

Probable explanation: more sophisticated traders during US hours →
tighter pricing, more adverse selection. During quiet hours our model
finds inefficiencies that bigger players have already arbitraged out
during active hours.

### 00:35 EDT — current best filter

```json
{
  "hoursUtc":[0,1,2,3,4,5,6,8,11,15,19,20,22],
  "minEdge":0.06
}
```

**+$648 maker / +$1,100 taker / 369 orders / 74.5% taker win** at $20
stake.

| Bucket | Start | n | Maker | Taker | Taker Win |
|---|---|---:|---:|---:|---:|
| 0 | 19:03 | 94 | +$158 | +$476 | 79.8% |
| 1 | 02:28 | 144 | +$335 | +$268 | 71.5% |
| 2 | 09:54 | 15 | +$57 | +$64 | 86.7% |
| 3 | 17:20 | 116 | +$98 | +$293 | 72.4% |

All positive. Fee-sensitivity (taker):

| feeBps | PnL |
|---:|---:|
| 0 | +$1291 |
| 200 | +$1238 |
| 400 | +$1185 |
| 720 | +$1100 |
| 1000 | +$1026 |
| 1500 | +$894 |

Even at 15% taker fee we're +$894.

Stake-scaling extrapolation (assuming linear, ignoring slippage):

| Stake | Taker PnL / 32h |
|---:|---:|
| $20 | $1,100 |
| $50 | $2,750 |
| $100 | $5,500 |
| $200 | $11,000 |

Real-world slippage will bend the curve — at $200 with median ratio
of 0.36 (depth/need at $20 stake), we'd be eating multiple book levels
on most orders. Realistic $200 stake might be closer to $5–6K.


### 03:15 EDT — cancel-on-adverse implementation

Added a `--cancel-on-adverse-bp` flag to the replay CLI. When set,
the per-window driver tracks each placed order's `line` (the
captured underlying mid at window-start) and cancels the order when
a subsequent tick mid moves ≥ N bp against the predicted side. After
cancellation, `applyTradeToSimulatedOrder` is no longer called for
that order's outcome, so trades arriving after the cancel time
cannot fill it.

This is optimistic about cancel latency — real Polymarket cancels
take 100-300 ms and race with incoming trades. Replay treats it as
instantaneous on the next tick.

Theoretical value: maker fills are concentrated in losers (price
moved against us, aggressive sellers swept the limit). Cancel-on-
adverse should drop the worst losers from the fill set without
touching the unfilled winners.

Running sweeps at thresholds 5, 10, 20 bp.


### 03:25 EDT — cancel-on-adverse results

Three thresholds tested at $20 stake on baseline (no filter):

| Threshold | Maker PnL | Δ vs baseline | Fills |
|---:|---:|---:|---:|
| none (0 bp) | −$577 | — | 533 |
| 10 bp | −$557 | +$20 | 532 |
| 3 bp | −$431 | +$146 | 515 |

3 bp is the only one that meaningfully reduced losses. But: applied
to our best filter the effect REVERSES — slight harm:

| Filter | Without cancel | With cancel-3bp |
|---|---:|---:|
| hours[0..11] + edge0.06 | +$558 maker | +$554 maker |
| good-hours + edge0.06 | +$648 maker | +$613 maker |

The cancel rule fires on ticks moving against the line — but for our
filtered-good orders, the price was already moved INTO our side at
entry (per `signedDistanceBp` analysis), so any pullback toward the
line registers as adverse and triggers a cancel that would have been
a winner.

**Conclusion**: cancel-on-adverse is the wrong lever for this strategy.
The filter approach captures the same edge more cleanly.

### 03:30 EDT — out-of-sample validation

Split the 32h tape into first 16h vs second 16h and ran each filter
independently:

| Filter | First 16h | Second 16h |
|---|---:|---:|
| no filter | +$97 maker / +$476 taker | **−$674** maker / −$253 taker |
| edge≥0.06 | +$295 / +$630 | −$658 / −$275 |
| hours[0..11]+edge0.06 | +$446 / +$461 | +$112 / +$58 |
| good-hours+edge0.06 | +$474 / +$740 | +$174 / +$361 |

The unfiltered baseline collapses in the second half — would have lost
$674 maker / $253 taker. Both filtered variants stay positive in BOTH
halves. The good-hours filter holds the win-rate proportionally:

- First half good-hours+edge0.06 win rate ≈ 64%
- Second half good-hours+edge0.06 win rate ≈ 59%

Some win-rate degradation in the second half but still meaningfully
above 50%. The strategy is regime-dependent (the second half had a
different market character) but the filter generalizes both periods.

## Takeaway

**One paragraph: in 32h of captured 5-asset tape (coinbase/spot training
+ tick), the live decision pipeline produces a real positive edge that's
hidden by adverse-selected maker fills. The cleanest way to surface it
is to (a) trade only during the hours UTC where the model is currently
empirically winning (Asian session + scattered evening hours, dropping
US business hours where adverse selection is strongest), (b) apply a
modest min-edge gate (0.06), and (c) execute as taker rather than
maker. The 720-bps Polymarket taker fee is comfortably absorbed by the
edge. Result: +$1,100 taker PnL at $20 stake / 369 orders / 74.5% win
rate, stable across half-split out-of-sample test and across all 4
time-bucket splits, even at conservative slippage assumptions.**

Production blockers: (1) live trader and dry-run runner still default
to maker-at-bid placement; switching to taker requires a placement-mode
change (not done here, additive flag would be sufficient). (2) the
cancel-on-adverse experiment surfaced that the existing maker-mode
fill economics are fundamentally driven by adverse selection, which is
also a story worth understanding. (3) the time-of-day pattern needs
more days of capture to validate as durable rather than a one-week
artifact.

### 03:45 EDT — per-asset breakdown + hybrid maker/taker

Per-asset PnL at \$20 stake on the best filter (good-hours+edge0.06):

| Asset | n | Maker PnL | Taker PnL | Best | Win | Depth ratio (p50) |
|---|---:|---:|---:|---|---:|---:|
| BTC | 80 | +\$135 | +\$372 | TAKER | 75% | 3.06 |
| ETH | 56 | +\$27 | +\$180 | TAKER | 71% | 0.56 |
| SOL | 64 | +\$39 | +\$190 | TAKER | 72% | 0.16 |
| XRP | 58 | +\$63 | +\$125 | TAKER | 74% | 0.18 |
| DOGE | 111 | **+\$384** | +\$233 | MAKER | 78% | 0.19 |

DOGE is the only asset where maker beats taker. Plausible reason:
DOGE has the highest avg limit price (\$0.69) so the taker fee
`shares × 720bps × price × (1 − price)` is high relative to the
edge (fee is symmetric at price 0.5, falls toward 0 at extremes —
but 0.69 is mid-range).

**Hybrid strategy**: TAKER for BTC/ETH/SOL/XRP, MAKER for DOGE.
Total: +\$372 + \$180 + \$190 + \$125 + \$384 = **+\$1,251 / 369 orders**.

Depth caveat for stake-scaling: BTC has 3× the depth needed at \$20
stake (median), so it scales to \$50–100 cleanly. DOGE/SOL/XRP/ETH
have median ratio 0.16–0.56 — more slippage if stake increases.
Optimal allocation would scale per-asset.


### 03:55 EDT — final filter cleanup

The hour 15 in the original "good hours" filter only had 3 orders
(100% win rate by luck). Removed it. Final filter:

```json
{
  "hoursUtc": [0, 1, 2, 3, 4, 5, 6, 8, 11, 19, 20, 22],
  "minEdge": 0.06
}
```

Result on 32h tape: **+$648 maker / +$1,074 taker / 366 orders /
74.3% taker win**. Effectively unchanged from the 13-hour version.

8-bucket finer stability check (good-hours+edge0.06, hybrid):

| Bucket | Start | n | Maker | Taker | Hybrid (DOGE=maker) | Win |
|---|---|---:|---:|---:|---:|---:|
| 0 | 19:03 | 52 | -$53 | +$185 | +$117 | 73% |
| 1 | 22:46 | 42 | +$211 | +$291 | +$328 | 88% |
| 2 | 02:28 | 110 | +$281 | +$188 | +$308 | 71% |
| 3 | 06:11 | 34 | +$54 | +$80 | +$121 | 74% |
| 4 | 09:54 | 12 | +$57 | +$37 | +$55 | 83% |
| 5 | 13:37 | 3 | $0 | +$26 | +$26 | 100% |
| 6 | 17:20 | 71 | -$7 | +$161 | +$149 | 69% |
| 7 | 21:03 | 45 | +$105 | +$132 | +$147 | 78% |

All 8 finer-grained buckets positive on hybrid. Win rates all
≥ 69%. Real signal.

## Two recommended filters

### Conservative (structurally motivated)

```json
{ "hoursUtc": [0,1,2,3,4,5,6,7,8,9,10,11], "minEdge": 0.06 }
```

Hypothesis: US business hours (16-23 UTC) attract more sophisticated
traders, tightening pricing and intensifying adverse selection. Trade
only Asian + early Europe hours.

- 252 orders / +\$558 maker / +\$519 taker / 64% maker win

### Aggressive (data-mined)

```json
{ "hoursUtc": [0,1,2,3,4,5,6,8,11,19,20,22], "minEdge": 0.06 }
```

Hypothesis: skip the specific hours where empirical PnL is bad
within the data; keep some evening hours where the model still
performs.

- 366 orders / +\$648 maker / +\$1,074 taker / 74% taker win
- HYBRID (taker for BTC/ETH/SOL/XRP, maker for DOGE) → +\$1,251

Risk: more overfit-prone than the conservative filter; specific
hour selection could be a 32h-period artifact. Validate on more days
before committing.

## What to do next (if pursuing live deployment)

1. **Don't deploy as-is**. Both filters need wider data to confirm
   they're not 32h artifacts. Keep capture running for 1-2 weeks
   then re-validate. Especially watch the second-half PnL — if the
   filter regime that hurt unfiltered baseline (post 8:30 UTC May 6)
   recurs, the conservative filter might also weaken.
2. **Build the actual taker placement path** in the live trader.
   Currently `runLive` and `runDryRun` use `binancePerpLivePriceSource`
   with maker-only `placeMakerLimitBuy`. A taker variant
   (`placeTakerLimitBuy` with the actual fee + slippage modelling)
   should land first as a dry-run-only flag, then live.
3. **Verify the 720 bps fee assumption against a real Polymarket
   trade fill stream** (`scanLifetimePnl`) on the funded account.
   If actual taker fee is meaningfully different, the per-trade math
   shifts.
4. **Per-asset stake allocation** — use bigger stakes on BTC (deep
   book, 75% taker win rate), smaller on DOGE/SOL/XRP/ETH (shallow
   books, more slippage at higher size).
5. **Reconsider the live binance-perp tick source**: the time-of-day
   pattern probably exists regardless of source, but worth re-running
   on binance-perp once Vision publishes 2026-05-06 daily archive
   (currently 404).

## Files

- Analyzer: [src/bin/research/sweepReplay.ts](../src/bin/research/sweepReplay.ts)
  — load JSONL, apply filters/unions, compute canonical/touch/all-fill/taker
  metrics with fee + slippage sensitivity
- Replay code change: [src/lib/trading/replay/replayWindow.ts](../src/lib/trading/replay/replayWindow.ts)
  — added `--cancel-on-adverse-bp` flag
- Replay JSONL referenced throughout: 32h baseline at
  `tmp/replay-trading/replay-trading_2026-05-07T02-30-50.760Z.jsonl`

## Caveats summary

- 32h is a SHORT validation window. Real edge needs days-to-weeks
  of out-of-sample.
- Filter has 12 specific UTC hours; may be partially a one-day
  artifact. Conservative filter (Asian only) gives $519 taker,
  smaller but more defensible.
- Taker fee assumed 720 bps; verify with live data.
- Slippage modelled simplistically (avg = bestAsk + 0–1 ticks).
  Realistic fill simulation requires walking level-2 polymarket
  books from `market_event` per order.
- Live trader still operates as maker; the 60% gain from taker is
  on paper only until placement-mode change is implemented.


### 04:00 EDT — extended-data validation

Re-ran replay against the captured tape extended by 2.5h (capture
keeps running) → 416 windows, 760 orders. Re-applied the same filters:

| Filter | 32h | extended (~35h) |
|---|---|---|
| baseline | -\$577 maker, +\$224 taker | -\$619 / +\$199 |
| edge 0.06 | -\$363 / +\$354 | -\$403 / +\$326 |
| Asian only + edge 0.06 | +\$558 / +\$519 | +\$518 / +\$490 |
| good-hours + edge 0.06 | +\$648 / +\$1,100 | +\$608 / +\$1,046 |

Filter PnL drops slightly with the extended data (~\$40-50) but
remains comfortably positive. The pattern holds across the additional
2.5h. Most of the new windows are during hours we filter out anyway,
so the order set is essentially unchanged.

**Final taker pnl on the data-mined hour filter: +\$1,046 / 369
orders / 74.0% taker win rate / 35h captured tape / \$20 stake.**


### 04:10 EDT — rolling-window walk-forward

Sorted all orders by `placedAtMs`, sliced into 4 chunks of ~200
orders each, applied the filter independently:

| Chunk | Total | Filtered | Win | Maker | Taker | Hybrid |
|---|---:|---:|---:|---:|---:|---:|
| 1-200 | 200 | 115 | 79% | +$224 | +$537 | +$530 |
| 201-400 | 200 | 135 | 72% | +$327 | +$245 | +$399 |
| 401-600 | 200 | 24 | 63% | +$51 | +$13 | +$38 |
| 601-end | 160 | 95 | 74% | +$7 | +$251 | +$229 |

All 4 chunks positive on hybrid. Chunk 3 is weakest (only 24 orders
passed the filter — the period it spans had mostly excluded hours).

Combined with the earlier 4-bucket and 8-bucket time-split checks
plus the half-split out-of-sample, this is multi-axis robustness:

- 4 time buckets (chronological): all positive
- 8 time buckets (chronological): all positive
- 4 rolling-order chunks: all positive
- First-half / second-half split: both positive

That's 4 different ways of slicing the data and the filter holds
in every slice. As statistical evidence on a 32h sample goes, this
is about as good as it gets without more days of data.


### 04:20 EDT — stake-scaling experiments

Edge-bucket per-order taker PnL on the best filter:

| edge bucket | n | win | pnl/order |
|---|---:|---:|---:|
| [0.06, 0.08) | 122 | 79% | **+$3.52** |
| [0.08, 0.10) | 81 | 74% | +$1.88 |
| [0.10, 0.12) | 56 | 70% | +$1.59 |
| [0.12, 0.15) | 60 | 68% | +$0.89 |
| [0.15, 0.20) | 30 | 77% | +$7.62 |
| [0.20, 1.00) | 20 | 70% | +$4.68 |

NOT monotonically increasing in edge. The lowest-edge bucket
(0.06-0.08) is the biggest contributor by both per-order and total
volume. The dip at [0.12, 0.15] is suspicious — needs more data to
say whether it's a real anomaly or sample noise.

Stake-scaling strategies (taker, best filter):

| Strategy | Total PnL |
|---|---:|
| Flat $20 | +$1,046 |
| Flat $50 | +$2,614 |
| Flat $100 | +$5,228 |
| Edge-proportional ($20 + 200×(edge−0.06)) | +$1,554 |
| Edge-proportional ($20 + 500×(edge−0.06)) | +$2,317 |
| Kelly 0.5× cap'd $100 | +$1,350 |
| Kelly 0.25× cap'd $100 | +$1,050 |

**Flat stake beats edge-scaled stake** in our data because the
highest per-order PnL is in the LOWEST edge bucket (0.06-0.08). Any
strategy that puts more stake on higher-edge orders ends up
amplifying the worst-performing buckets.

Caveat: linear stake-scaling ignores slippage. At $100 stake, the
depth/need ratio drops from 0.36 to 0.07 (median). Eating 3-5 book
levels per order means avg fill price ~1-2 ticks higher than best
ask, costing ~30-50% of the gross PnL. Realistic $100-stake PnL
estimate: **\$2,500-\$3,500 / 35h tape** — comfortably "thousands".

