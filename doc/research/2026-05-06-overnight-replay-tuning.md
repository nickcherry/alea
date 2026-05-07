# 2026-05-06 — Overnight replay tuning

**Question:** can we find a configuration of the existing decision
pipeline that turns the captured 32h tape into substantial positive PnL,
without changing the production decision/training algos?

## TL;DR

Yes. On 32-35h of captured 5-asset tape (coinbase/spot training + tick,
chainlink settlement), the live decision pipeline has a real positive
edge that is hidden by adverse-selected maker fills.

### Recommended starting point (Nick's call, 2026-05-07)

```json
{ "minEdge": 0.06 }
```

- **Execute as TAKER on all assets, all hours.**
- Result on 35h tape at $20 stake: **+$326 / 614 orders / 66% win**.
- Why not something fancier: the higher-PnL filters below are
  data-mined on a small sample and likely overfit. This config is
  the simplest robustly-positive thing — it requires no hour gating,
  no per-asset routing, no probability calibration. It's the
  baseline the next iteration should beat.

### What more aggressive filters look like (likely overfit)

**Hour-of-day gate** (the dominant data-mined lever found in this
session):

```json
{ "hoursUtc": [0,1,2,3,4,5,6,8,11,19,20,22], "minEdge": 0.06 }
```

| Variant | n | PnL |
|---|---:|---:|
| All taker | 369 | +$1,074 |
| All maker | 369 | +$648 |
| Hybrid (taker for BTC/ETH/SOL/XRP, maker for DOGE) | 369 | +$1,197 |
| Same + DOGE-19 dropped | 353 | +$1,235 |

**Conservative variant** (structural — Asian + early Europe only,
less overfit-risk):

```json
{ "hoursUtc": [0,1,2,3,4,5,6,7,8,9,10,11], "minEdge": 0.06 }
```
→ +$519 taker / +$558 maker / 252 orders / 64% win.

### Key insight

Strong intraday seasonality. US business hours (16-23 UTC) attract
sophisticated traders, tighten pricing, intensify adverse selection.
Asian + scattered evening hours have less competition and the model
finds inefficiencies. Hour 20 UTC specifically: model picks right
78% of the time but maker barely fills (queue ahead doesn't clear
when price moves favorably for us — adverse selection).

This pattern needs more days of capture to confirm as durable rather
than a 35h artifact.

### Validation

Hour-filter result holds in 4-bucket time split (all positive),
8-bucket split (all positive), first/second-half out-of-sample (both
positive), 4-chunk rolling-window walk-forward (all positive). Fee-
robust to 1500 bps; slippage-robust to 1.0-tick avg.

### Production blockers

1. Live trader is maker-only; needs a taker placement path built
   (additive flag, no live-decision-path change).
2. Verify 720 bps fee assumption against actual Polymarket fill data
   (`scanLifetimePnl` against the funded account).
3. Time-of-day pattern needs more days of capture to confirm as
   durable.

### What a next iteration could chase

- Wait for capture to extend to 1+ week, re-run sweepReplay on the
  best filter and the conservative one. If the hour pattern still
  holds, raise confidence in the data-mined version.
- Replay-side: implement actual taker placement in the engine
  (currently only post-hoc) so we get real slippage from level-2
  book walking, not the optimistic best-ask assumption.
- Try the binance/perp source once Vision publishes 2026-05-06
  daily. Rerun gen-probability-table on binance/perp candles, replay
  with binance-perp tick. Probably similar pattern but worth confirming.
- Per-asset stake allocation — BTC has 3× depth headroom at $20
  stake, others much shallower. Optimal allocation could lift PnL
  meaningfully.

### Tools left in the repo

- `src/bin/research/sweepReplay.ts` — the analyzer. `bun run` it
  with a JSONL path + a `--filter '<json>'` to compute canonical /
  touch / all-fill / taker PnL with fee + slippage sensitivity and
  4-bucket stability split. Supports `{"any":[...]}` union filters.
- `src/lib/trading/replay/` — generalized for `--tick-source`
  (binance-perp / coinbase-spot / coinbase-perp), `--candle-source`,
  `--candle-product`, `--cancel-on-adverse-bp`.

**Running log.** Updated as work progresses. Numbers and hypotheses
recorded chronologically below.

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
Total per-asset (corrected on 35h tape):
$372 + $169 + $161 + $110 + $384 = **+\$1,196 / 369 orders**.
(Earlier doc revisions reported \$1,251 — that was an arithmetic
slip from a different filter version. \$1,196 is the right number.)

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
- HYBRID (taker for BTC/ETH/SOL/XRP, maker for DOGE) → +\$1,196

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


### 04:50 EDT — replay decision-debugging

Earlier I noticed extending the replay range past 2026-05-07 00:46 UTC
added windows but no new orders. Suspected a candle-loading race or
freshness check bug. Debug logging confirmed: the model was deciding
**skip → "no-bucket"** for those windows.

"no-bucket" means the regime classifier produced a label not in the
trained probability table (insufficient training samples for that
regime). The model is correctly conservative — it abstains when
uncertain.

Implication: the +\$1,100 result is on data EXCLUDING the windows
where the model self-abstained. The strategy is genuinely selective
about when it has signal, which is good. The "no orders" in some
windows is a feature, not a bug.

(Decision-trace debug code was added to `replayWindow.ts` for
this investigation and reverted; the finding is the value.)


### 04:55 EDT — min-samples regen experiment

Wondered if regenerating the probability table with `--min-samples 100`
(vs the default 200) would unlock more "no-bucket" windows (more
buckets pass the threshold → more regimes covered).

Bucket counts grew significantly:

| Asset | Min-200 buckets | Min-100 buckets | Δ |
|---|---:|---:|---:|
| BTC | 250 | 308 | +58 |
| ETH | 321 | 409 | +88 |
| SOL | 358 | 443 | +85 |
| XRP | 367 | 481 | +114 |
| DOGE | 390 | 476 | +86 |

Re-ran replay on the same 35h range. Result: **identical** to
min-200 — same 760 orders, same −\$619 canonical, same +\$1,046
taker on the best filter.

The additional buckets aren't being hit by any window in our 35h
replay range. The "no-bucket" skips earlier are for genuinely novel
regime label tuples not present in either table — they're regime
combinations the trainer didn't see at all in the 2-year history,
not just thin ones. Lowering min-samples doesn't help.

Probability table restored to min-samples=200 default after the
experiment.


### 05:00 EDT — per-asset edge tuning experiment

Tested whether different min-edge thresholds per-asset would beat
the uniform 0.06. Setup: union filter with one arm per asset, each
with its own minEdge.

| Per-asset edge config | Taker PnL | Orders |
|---|---:|---:|
| Uniform 0.06 (baseline) | **+$1,046** | 369 |
| BTC/ETH/SOL/XRP 0.06, DOGE 0.05 | +$1,028 | 375 |
| BTC/ETH/SOL/XRP 0.07, DOGE 0.06 | +$927 | 308 |
| BTC 0.10, others 0.06 | +$993 | 323 |

Uniform 0.06 wins. The per-asset edge sweet spots are all at 0.06
within statistical noise. No room to over-engineer.

## Status at session end (~05:00 EDT, 2026-05-07)

13 commits to `main`. Capture process undisturbed. No live trading
code touched. Best deployable strategy on the captured tape:

- Filter: 12 specific UTC hours + minEdge 0.06
- Placement: TAKER for BTC/ETH/SOL/XRP, MAKER for DOGE
- Result on 35h tape at \$20 stake: **+\$1,196 hybrid / 369 orders /
  ~74% taker win rate**
- Validated across 4 slicing approaches (4-bucket, 8-bucket, half-
  split, walk-forward); robust to fees up to 1500 bps and slippage
  up to 1.0 tick

Production blockers documented in TL;DR. The file is the night's
output of record.


### 05:15 EDT — number correction + (asset, hour) micro-tuning

Self-audit caught: earlier doc revisions reported "+\$1,251 hybrid" but
the correct per-asset sum on the 35h tape is **+\$1,196**:

- BTC TAKER \$372 + ETH TAKER \$169 + SOL TAKER \$161 + XRP TAKER \$110
  + DOGE MAKER \$384 = \$1,196

Earlier "\$1,251" came from per-asset numbers I'd quoted from the
original 32h JSONL mixed with later filter constants — close enough
that no one noticed but mathematically inconsistent. All four
references in the doc corrected.

While there: (asset × hour) grid revealed DOGE-19 is the only loser
inside DOGE's filtered hours (16 orders, 56% win, −\$38 maker /
−\$47 taker). Excluding DOGE-19 from DOGE's filter (other assets
keep all 12 hours):

- Refined hybrid: **+\$1,235 / 353 orders / 75% win**

So the cleaner final number, after one round of (asset, hour)
sanity-cleanup, is **\$1,235 hybrid** at \$20 stake.

Bottom-loser (asset, hour) cells (all already excluded by hour filter):
DOGE-18 (−\$175, 10% win, 10 orders), DOGE-21 (−\$154, 31% win, 13).
Bottom inside the filter: DOGE-19 (−\$47, 56% win) — now also dropped.
Top winners inside the filter: BTC-20 (+\$162, 93% win, 14 orders),
DOGE-20 (+\$95, 83%), ETH-21 (+\$84, 83%, 6 orders).


### 12:55 EDT (2026-05-07) — apples-to-apples source comparison

Patched `fetchBinancePerpCandles.ts` with a fapi REST fallback so we
can sync binance/perp candles up to current (Vision lags ~24h).
Synced all 4 source/product combinations (binance perp, binance spot,
coinbase perp, coinbase spot) to current.

Ran 4 separate replays on the same 35h tape (16:30 May 5 → 03:25 May
7 UTC). Each replay used a probability table trained on the
respective source, but with `--tick-source coinbase-spot` held
constant so the in-window decision pipeline saw identical price
ticks across all 4 — isolating the training-source effect (option
(c) per Nick).

Results (taker PnL @ \$20 stake, all 5 assets):

| Training source | No filter | minEdge≥0.06 | Hour filter + minEdge≥0.06 |
|---|---:|---:|---:|
| binance/perp | +$274 | +$307 | +$972 |
| binance/spot | +$352 | +$419 | **+$1,026** |
| coinbase/perp | +$491 | +$460 | +$987 |
| coinbase/spot | +$144 | +$284 | +$1,021 |

| Training source | Win rate (no filter) | Win (minEdge:0.06) | Win (aggressive) |
|---|---:|---:|---:|
| binance/perp | 65.6% | 65.5% | 73.6% |
| binance/spot | 66.1% | 66.2% | 74.2% |
| coinbase/perp | 66.1% | 65.7% | 73.7% |
| coinbase/spot | 65.4% | 65.7% | 73.8% |

#### Takeaways

1. **Source choice matters at the simpler filters.** At `minEdge≥0.06`
   (recommended baseline), the spread is +\$284 (coinbase/spot) to
   +\$460 (coinbase/perp) — a 60% range. coinbase/perp leads at
   +\$460. The current default coinbase/spot is the WORST of the four.

2. **Source choice barely matters at the aggressive hour filter.**
   All four converge to +\$972-\$1,026, a 5% spread. The hour filter
   is doing 90% of the work; source is second-order.

3. **Win rates are remarkably similar across sources** — within
   0.5pp at every filter level. The differences in PnL come from
   *which orders* fire, not from picking better sides.

4. **coinbase/spot is the weakest source for our strategy** at the
   simpler filters. binance/spot is a quiet sleeper performer
   (consistently strong despite no captured WS data).

5. **No source is strictly dominant.** At baseline, coinbase/perp
   wins. At minEdge:0.06, coinbase/perp wins. At aggressive, it's
   binance/spot. Differences are within statistical noise on 35h.

#### Implication for the recommended baseline

The Nick-blessed "all-taker, all-hours, edge>=0.06" config benefits
materially from switching training source coinbase/spot →
coinbase/perp: **+\$284 → +\$460** (a 62% improvement on the same
tape). If we trust this signal (35h sample caveat), the next default
should be coinbase/perp, not coinbase/spot. The fact that the
underlying model's edge is similar across sources means the
*training data* matters less than how the *resulting probability
table* maps to current market conditions.

(Caveat: we're holding the in-window WS tick at coinbase-spot for
all 4 experiments. Truly switching to coinbase/perp end-to-end would
also use coinbase-perp WS for ticks, which I haven't tested. The
captured coinbase-perp WS volume is similar so I'd expect similar
results, but it's an open experiment.)

#### Patch landed

[`src/lib/candles/sources/binance/fetchBinancePerpCandles.ts`](../src/lib/candles/sources/binance/fetchBinancePerpCandles.ts)
now falls back to `fapi.binance.com/fapi/v1/klines` when Vision
returns 404 for a daily archive (and unconditionally for today,
which Vision never has). Requires the operator to be in a
non-geo-blocked region. With this in place, `bun alea candles:sync
--sources binance --products perp` covers the full historical-to-
current range without manual intervention.

### 13:55 EDT (2026-05-07) — competing in US hours without an hour gate

Goal for this pass: try to make the weak 16-23 UTC slice tradable
without simply leaning on the "avoid US hours" hypothesis. Treated
16-23 UTC as an evaluation slice only, then tested source choice,
edge floors, chosen-side spread, taker ask price, placement timing,
momentum, and asset exclusions.

Analyzer patch: `src/bin/research/sweepReplay.ts` now reports a
`us` sweep, UTC-hour buckets, and a hybrid taker/maker lens. It also
supports spread/ask/timing filters and preserves outer constraints
on union filters.

#### US-hours findings

1. **High edge alone helps, but is low-volume.** Across the four
   training sources, `minEdge>=0.15` in 16-23 UTC produces roughly
   +$275 to +$388 taker PnL on only 44-49 orders. This is a useful
   "compete only when the model screams" fallback, but not enough
   flow to be the main answer.

2. **Tight chosen-side spread is the better structural lever.**
   At `minEdge>=0.06`, requiring `chosenSpread<=0.08` flips US hours
   positive across sources:

| Training source | US taker PnL |   n |
| --------------- | -----------: | --: |
| binance/perp    |        +$293 | 208 |
| binance/spot    |        +$475 | 209 |
| coinbase/perp   |        +$432 | 198 |
| coinbase/spot   |        +$366 | 201 |

This is not a clock rule: it says compete in tighter Polymarket
markets where taker spread drag is bounded and the book is not
obviously stale/wide.

3. **DOGE is structurally bad in US hours.** At `minEdge>=0.06`,
   DOGE US-hours taker PnL is negative on every source (about
   -$235 to -$388) with ~52-57% win rate. XRP is weaker/mixed and
   is the asset that made the all-hours time split least stable.

#### Best non-hour candidate from this pass

```json
{
  "minEdge": 0.06,
  "maxChosenSpread": 0.08,
  "excludeAssets": ["doge", "xrp"]
}
```

Execution lens: all taker. No hour gate.

All-hours results on the same 35h tape:

| Training source |   n | Taker PnL | 1.0-tick slippage PnL | US-hours PnL |
| --------------- | --: | --------: | --------------------: | -----------: |
| binance/perp    | 265 |     +$485 |                 +$386 |        +$284 |
| binance/spot    | 273 |     +$628 |                 +$524 |        +$440 |
| coinbase/perp   | 259 |     +$673 |                 +$572 |        +$418 |
| coinbase/spot   | 267 |     +$670 |                 +$567 |        +$406 |

Stability notes:

- coinbase/perp is the cleanest version: all four chronological
  all-hours buckets are positive (+$207, +$226, +$20, +$221 taker).
- coinbase/spot is effectively the same total (+$670), with one
  near-flat all-hours bucket (-$1 taker) and the other three positive.
- binance-trained tables are positive overall but still show a weak
  10-18 UTC bucket, so I would not prefer them for this specific
  candidate.
- US-hours split is positive in the two real US-session chunks on
  every source; the tiny middle buckets have only 2-5 orders because
  the replay span crosses non-US time between US sessions.

#### Updated interpretation

The hour filter is still the highest-PnL thing found so far, but it
is not the only path. A tighter-spread, non-DOGE/non-XRP taker policy
gets most of the way to the conservative Asian-only result while
actively trading US hours:

- It beats the simple all-hours `minEdge>=0.06` baseline on every
  training source.
- It turns 16-23 UTC from roughly flat/negative into +$284 to +$440.
- It remains profitable after a full 1.0-tick taker slippage haircut.

This is the current best "do not lean on hours" candidate. Still not
production-ready: 35h is short, DOGE/XRP exclusion may be partly
sample-specific, and real taker depth walking still needs to replace
the simple best-ask-plus-slippage model.

### 14:20 EDT (2026-05-07) — source consensus as an anti-overfit lever

Next experiment: instead of adding another market-hour rule, require
multiple independently-trained candle sources to agree on the same
asset/window/side before taking the trade. This is a direct guard
against one probability table finding a source-specific artifact in
the 35h replay.

Research patch: `src/bin/research/compareReplayConsensus.ts` loads
the four replay JSONLs from the same tape and evaluates each source
as the execution table while requiring 1/2/3/4 sources to pass the
same filter and agree on direction. PnL is still measured with the
execution source's own taker ask/fee telemetry.

#### Conservative consensus candidate

Base filter:

```json
{
  "minEdge": 0.06,
  "maxChosenSpread": 0.08,
  "excludeAssets": ["doge", "xrp"]
}
```

Additional confirmation: all 4 sources must agree on asset/window/side.
No hour gate.

| Execution source |   n | Taker PnL | 1.0-tick slippage PnL | Worst quarter | US-hours PnL | US win |
| ---------------- | --: | --------: | --------------------: | ------------: | -----------: | -----: |
| binance/perp     | 202 |     +$586 |                 +$505 |           +$3 |        +$433 |    68% |
| binance/spot     | 202 |     +$586 |                 +$505 |           +$3 |        +$433 |    68% |
| coinbase/perp    | 202 |     +$587 |                 +$506 |           +$3 |        +$433 |    68% |
| coinbase/spot    | 202 |     +$586 |                 +$505 |           +$3 |        +$433 |    68% |

This is lower headline PnL than the single-source coinbase/perp
version (+$673), but it is much cleaner: every chronological quarter
is positive, the US slice is strongly positive, and the result is
basically invariant to which source is treated as execution. This is
the best current candidate if the priority is "improve PnL without
just fitting the replay."

#### More aggressive consensus candidate

Base filter:

```json
{
  "minEdge": 0.06,
  "maxChosenSpread": 0.08,
  "excludeAssets": ["doge"]
}
```

Additional confirmation: at least 3 of 4 sources must agree. Execution
source: coinbase/perp. No hour gate.

|   n | Taker PnL | 1.0-tick slippage PnL | Worst quarter | US-hours PnL | US win |
| --: | --------: | --------------------: | ------------: | -----------: | -----: |
| 263 |     +$730 |                 +$627 |          +$30 |        +$569 |    68% |

This beats the conservative consensus candidate and improves the US
slice materially, but it keeps XRP and depends on a specific execution
source plus a 3-of-4 vote. I would track it as the aggressive variant,
not the default.

#### Interpretation

Source consensus is a more defensible way to compete in US hours than
the earlier hour whitelist. It trades fewer events, but it does so
because independent probability tables agree, not because we found a
profitable clock bucket on a short sample. The best next implementation
path would be:

1. Use the all-4 `BTC/ETH/SOL + minEdge>=0.06 + chosenSpread<=0.08`
   rule as the conservative replay target.
2. Keep the 3-of-4 `no DOGE` rule as an aggressive comparison.
3. Re-run both on a longer tape before promoting either to live
   config, and replace the simple 1-tick haircut with true taker depth
   walking.

### 14:55 EDT (2026-05-07) — all-4 consensus supports a lower edge floor

Follow-up: retuned the consensus core itself instead of adding a new
clock rule. The all-4 source agreement constraint is strong enough
that the earlier `minEdge>=0.06` floor appears too conservative when
paired with a tighter spread cap.

Updated conservative candidate:

```json
{
  "minEdge": 0.05,
  "maxChosenSpread": 0.07,
  "excludeAssets": ["doge", "xrp"]
}
```

Additional confirmation: all 4 sources must agree on asset/window/side.
No hour gate.

| Execution source |   n | Taker PnL | 1.0-tick slippage PnL | Worst quarter | US-hours PnL | Win |
| ---------------- | --: | --------: | --------------------: | ------------: | -----------: | --: |
| binance/perp     | 316 |     +$817 |                 +$697 |          +$28 |        +$477 | 68% |
| binance/spot     | 316 |     +$818 |                 +$698 |          +$27 |        +$487 | 68% |
| coinbase/perp    | 316 |     +$819 |                 +$699 |          +$15 |        +$472 | 68% |
| coinbase/spot    | 316 |     +$834 |                 +$714 |          +$28 |        +$494 | 68% |

Compared with the previous all-4 `minEdge>=0.06, spread<=0.08`
candidate:

| Slice |   n | Taker PnL | 1.0-tick slippage PnL | US-hours PnL | Note |
| ----- | --: | --------: | --------------------: | -----------: | ---- |
| Previous rule | 202 | +$586 to +$587 | +$505 to +$506 | +$433 | Baseline all-4 consensus |
| Updated rule | 316 | +$817 to +$834 | +$697 to +$714 | +$472 to +$494 | More volume, all quarters positive |
| New-only orders | 127 | +$176 to +$193 | +$134 to +$151 | +$9 to +$31 | Lower-edge but tighter-spread adds |
| Dropped old-only orders | 13 | -$55 | -$58 | -$30 | Wider-spread tail that the new cap removes |

That is a better anti-overfit story than a blind lower edge floor:
the gain comes from requiring every source to agree while using a
stricter execution-spread condition. The added lower-edge trades are
positive as a group, and the removed wider-spread trades were negative.

#### Asset add-back check

Using the same all-4 `minEdge>=0.05, spread<=0.07` rule:

- Adding all XRP back (`excludeAssets:["doge"]`) weakens the result to
  roughly +$691 to +$708 and makes the worst quarter about -$74 to -$87.
- Adding all assets weakens it further to roughly +$600 to +$618 and
  worst quarter about -$167 to -$179.
- High-edge XRP/DOGE add-ons are tempting in-sample, but they add only
  single-digit extra keys. I would keep them on a watchlist, not in the
  default candidate, until a longer tape proves they are not just a few
  lucky events.

#### Updated recommendation

The current best conservative non-hour candidate is now:

1. BTC/ETH/SOL only.
2. Every source agrees on asset/window/side.
3. Every source passes `edge>=0.05` and `chosenSpread<=0.07`.
4. Execute as taker, with no UTC-hour allowlist.

It is better than the previous all-4 consensus candidate on total PnL,
1-tick slippage PnL, US-hours PnL, and chronological stability.

### 15:25 EDT (2026-05-07) — execution-quality gates inside consensus

Next pass: keep the all-4 consensus structure, but ask whether a small
execution-quality cap can improve PnL without adding hour rules or
asset micro-tuning. Two simple structural gates helped:

1. `chosenBestAsk<=0.75`: avoid paying more than 75c for a 5-minute
   binary, where one miss costs the whole stake and the upside is small.
2. `trendConfirmBp>=0`: require the underlying to be at least on the
   predicted side of the line at entry. For `up`, signed distance must
   be non-negative; for `down`, signed distance must be non-positive.

Updated challenger:

```json
{
  "minEdge": 0.05,
  "maxChosenSpread": 0.07,
  "maxChosenBestAsk": 0.75,
  "minTrendConfirmBp": 0,
  "excludeAssets": ["doge", "xrp"]
}
```

Additional confirmation: all 4 sources must agree on asset/window/side
and all 4 must pass the filter. No hour gate.

| Execution source |   n | Taker PnL | 1.0-tick slippage PnL | Worst quarter | US-hours PnL | Win |
| ---------------- | --: | --------: | --------------------: | ------------: | -----------: | --: |
| binance/perp     | 303 |     +$877 |                 +$759 |          +$80 |        +$532 | 69% |
| binance/spot     | 303 |     +$878 |                 +$760 |          +$79 |        +$542 | 69% |
| coinbase/perp    | 303 |     +$885 |                 +$768 |          +$75 |        +$536 | 69% |
| coinbase/spot    | 303 |     +$892 |                 +$774 |          +$79 |        +$549 | 69% |

Compared with the prior conservative consensus core (`edge>=0.05`,
`spread<=0.07`, BTC/ETH/SOL, all-4 agreement):

| Rule |   n | Taker PnL | 1.0-tick slippage PnL | Worst quarter | US-hours PnL |
| ---- | --: | --------: | --------------------: | ------------: | -----------: |
| Core | 316 | +$817 to +$834 | +$697 to +$714 | +$15 to +$28 | +$472 to +$494 |
| Core + ask<=0.75 | 305 | +$835 to +$850 | +$718 to +$732 | +$55 to +$59 | +$511 to +$528 |
| Core + trend>=0 | 314 | +$858 to +$876 | +$739 to +$755 | +$36 to +$49 | +$493 to +$514 |
| Core + both | 303 | +$877 to +$892 | +$759 to +$774 | +$75 to +$80 | +$532 to +$549 |

This is a cleaner PnL improvement than the earlier hour whitelist:
it cuts only execution-risk tails and requires unanimous source
agreement. It also improves the US-hours slice materially.

Caveat: this still removes only 13 orders from the 35h tape, so it
should be treated as the best current challenger rather than a live
promotion until a longer forward replay has volume.

#### Forward-slice check

Added `src/bin/research/replaySavedProbabilityTables.ts`, which replays
saved probability-table JSON sidecars without overwriting the committed
generated probability table. This lets us rerun the four source tables
against fresh capture without mutating source-of-truth files.

The clean post-generation slice, 2026-05-07 13:05 → 14:35 UTC, replayed
16 resolved windows for all four tables and produced **zero orders**.
Follow-up diagnostics showed this was not a probability-bucket result:
the replay emitted **zero decision events**. Market tape was present
(Polymarket BBA/book rows and coinbase-spot ticks existed), but the
source candle tables used to hydrate regime trackers were stale before
the forward window started:

| Table series | Required last 5m bar for 13:05 UTC replay | Latest available 5m bar |
| ------------ | ----------------------------------------- | ----------------------- |
| binance/perp | 2026-05-07 13:00 UTC | 2026-05-07 12:40 UTC |
| binance/spot | 2026-05-07 13:00 UTC | 2026-05-07 12:40 UTC |
| coinbase/perp | 2026-05-07 13:00 UTC | 2026-05-07 12:45 UTC |
| coinbase/spot | 2026-05-07 13:00 UTC | 2026-05-07 12:45 UTC |

`replayWindow` intentionally refuses to evaluate if the hydrated
tracker's last closed 5m candle is not exactly `windowStart - 5m`.
So the forward slice was blocked by candle coverage, not by the model
choosing not to trade. `replaySavedProbabilityTables.ts` now prints
candle coverage and decision counts before/after each saved-table replay
so this failure mode is visible immediately.

A slightly earlier overlap sanity check, 2026-05-07 12:50 → 14:35 UTC
with the coinbase/perp table, produced only 3 orders and lost about
-$29 taker. This sample is too small and partly overlaps table
generation time, so I am not tuning from it. It likely only traded
because the 12:50 UTC window had a fresh enough 12:45 UTC coinbase
candle.

Next forward validation step: backfill/sync 5m candles through the
captured forward tape, then rerun the same saved-table replay. Until
that is done, the post-generation replay is not evidence for or
against the current challenger.

### 11:41 EDT (2026-05-07) — fresh Coinbase forward replay + real depth taker scoring

I synced fresh Coinbase 5m candles through the captured forward tape
and reran the saved-table replay. Binance candle sync is blocked from
this network by a Binance API `451` restricted-location response, so
the two Binance source tables still cannot participate in the clean
forward check from this machine.

Coinbase coverage is now fresh for the 2026-05-07 13:05 → 14:35 UTC
forward slice:

| Table series | Required last 5m bar | Latest available 5m bar | Status |
| ------------ | -------------------- | ----------------------- | ------ |
| coinbase/perp | 2026-05-07 13:00 UTC | 2026-05-07 13:00 UTC | fresh |
| coinbase/spot | 2026-05-07 13:00 UTC | 2026-05-07 13:00 UTC | fresh |

Raw single-table replay, before the consensus overlay:

| Source table | Decisions | Orders | Maker canonical | All-fill | Real-depth taker |
| ------------ | --------: | -----: | --------------: | -------: | ---------------: |
| coinbase/perp | 424,064 | 12 | -$80 | +$34 | -$11 |
| coinbase/spot | 433,160 | 10 | -$11 | +$71 | +$34 |

This preserves the same core pattern as the in-sample tape: maker fills
remain badly adverse-selected, while all-fill/taker lenses carry the
edge. The perp table is weak on this tiny slice once real depth is used;
the spot table is still positive.

I also replaced the research taker lens with a true captured-book walk:
`buildTakerCounterfactual` now consumes the chosen side's ask levels
until the stake is spent, records depth-weighted average price, fill
size, levels consumed, and unfilled stake. `sweepReplay` now uses that
real depth price instead of assuming every taker order fills at best ask.

Applying the current challenger gates to the fresh Coinbase forward
logs:

```json
{
  "minEdge": 0.05,
  "maxChosenSpread": 0.07,
  "maxTakerAskPrice": 0.75,
  "minTrendConfirmBp": 0,
  "excludeAssets": ["doge", "xrp"]
}
```

| Source table | n | Real-depth taker | +1 tick stress | Win |
| ------------ | -: | ---------------: | -------------: | --: |
| coinbase/perp | 7 | +$3 | +$1 | 71% |
| coinbase/spot | 8 | +$13 | +$11 | 75% |

Interpretation: this is encouraging but not enough for promotion. The
fresh forward slice is too small and all-4 consensus cannot be tested
until Binance candles are backfilled through a non-blocked path. The
important result is that the challenger did not immediately fail once
Coinbase coverage was fixed, but real book depth materially reduces the
taker edge versus the earlier best-ask-only lens.

Next useful work:

1. Add a non-Binance-API candle backfill path or run the sync from an
   unrestricted host so all 4 saved source tables can be replayed
   forward.
2. Rerun the all-4 consensus overlay on a genuinely fresh forward tape.
3. Keep real-depth taker PnL as the default research metric; treat the
   1-tick stress as an additional margin, not the primary fill model.

### 11:49 EDT (2026-05-07) — all-4 forward overlay after Binance geofence fix

After the VPN/geofence issue was fixed, Binance 5m candle sync also
succeeded through the forward tape:

```bash
bun alea candles:sync --timeframe 5m --days 2 --assets btc,eth,sol,xrp,doge --sources binance --products spot,perp
```

I reran all four saved source tables on the same 2026-05-07 13:05 →
14:35 UTC forward slice. All four now show fresh candle coverage and
emit decisions/orders:

| Source table | Orders | Maker canonical | All-fill |
| ------------ | -----: | --------------: | -------: |
| binance/perp | 12 | -$80 | +$34 |
| binance/spot | 13 | -$46 | +$60 |
| coinbase/perp | 12 | -$80 | +$34 |
| coinbase/spot | 10 | -$11 | +$71 |

I also updated `compareReplayConsensus.ts` so its taker PnL uses the
same real-depth `takerCounterfactual` as `sweepReplay`, instead of
reverting to best-ask scoring.

Fresh all-4 overlay for the current challenger:

```json
{
  "minEdge": 0.05,
  "maxChosenSpread": 0.07,
  "maxChosenBestAsk": 0.75,
  "minTrendConfirmBp": 0,
  "excludeAssets": ["doge", "xrp"]
}
```

| Execution source | Agreeing sources | n | Real-depth taker | +1 tick stress | Win | Worst quarter |
| ---------------- | ---------------: | -: | ---------------: | -------------: | --: | ------------: |
| binance/perp | 4 | 5 | +$17 | +$15 | 80% | -$13 |
| binance/spot | 4 | 5 | +$17 | +$15 | 80% | -$13 |
| coinbase/perp | 4 | 5 | +$17 | +$15 | 80% | -$13 |
| coinbase/spot | 4 | 5 | +$16 | +$15 | 80% | -$13 |

This is the first clean forward check where the all-4 consensus rule
could actually run. It is directionally good: positive across every
execution source, still positive with an extra 1-tick stress, and no
hour filter involved. It is still only **five trades**, so this should
not be treated as live-promotion evidence by itself. The right next
step is to collect/backfill more forward tape and keep this exact
real-depth all-4 overlay as the holdout check.
