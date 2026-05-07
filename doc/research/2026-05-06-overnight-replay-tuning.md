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

