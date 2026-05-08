# EV / reward-risk gate calibration

**Date:** 2026-05-07
**Tool:** `bun alea trading:calibrate-ev-rr-gate` ([source](../../src/bin/trading/calibrateEvRrGate.ts))
**Replay sessions:** 3 sessions covering the same 35-hour window
(`1777998600000 → 1778124300000` ms — ~2026-05-05 19:30 UTC through
2026-05-07 06:25 UTC), 760–766 orders per session.

## Motivation

The runner's `MIN_EDGE` gate is dimensionless: it asks "do we think
the side is mispriced by ≥ 5pp?" but doesn't see the asymmetric
payoff. A 5pp edge at fill price 0.55 buys $16+ of upside on a $20
stake; the same 5pp edge at fill price 0.85 buys ~$3 of upside,
risking the full $20 either way. Both pass `MIN_EDGE` — but the
second is a much worse trade.

That asymmetry (consistent full-stake losses vs. occasional $3–$5
wins) is what we observed in production once the trader was
catching the high-probability tail of the model. The new gate
enforces a dollar-EV floor and a reward-risk ratio floor that the
existing model gates don't see.

## Methodology

The calibration runs **post-hoc** on existing replay JSONL sessions —
no need to re-run replay for every (MIN_EV, MIN_RR) candidate. For
each order in the session:

1. Re-derive the *taker* economics from the order's stored
   `takerCounterfactual`:
   - `fillPrice = takerCounterfactual.askPrice` (depth-weighted avg)
   - `shares = takerCounterfactual.sharesIfFilled`
   - `costUsd = takerCounterfactual.costUsd` (≈ stake at the walked
     book)
   - `feeUsd = shares × 0.07 × fillPrice × (1 − fillPrice)` — the
     ~700bps Polymarket charges takers, derived empirically from
     `/activity` (the venue's `/trades` field reports `"0"` even
     when the wallet was charged).
2. Compute `evUsd` and `rewardRiskRatio` per the same formulas
   `computeTradeEconomics` uses live.
3. If both gates pass, count the trade and add its realized PnL
   (using the venue-truth `officialOutcome` or chainlink-derived
   `replayOutcome` from the session). Otherwise skip.

This treats the session's existing model decisions as fixed and
asks: "which subset of those would the new gate keep, and what's
the resulting bottom line?" That's exactly the production question
once the new gate is live.

## Sweep grid

```
MIN_EV  ∈ {0.00, 0.25, 0.50, 0.75, 1.00, 1.50, 2.00, 3.00, 4.00}
MIN_RR  ∈ {0.00, 0.10, 0.15, 0.20, 0.25, 0.30, 0.40, 0.50}
```

72 (EV, RR) cells per session × 3 sessions = 216 evaluations.

## Findings (representative session — full output for all three
sessions reproduced from the script)

```
session: replay-trading_2026-05-07T03-48-48.606Z.jsonl
  orders: 760
  baseline (no EV/RR gate): taken=760 wins=499 (65.7%) pnl=+$209.68
                            fees=+$385.89 pnl/trade=+$0.28

PnL ($) heatmap — rows: MIN_EV, cols: MIN_RR
  MIN_EV     0.00     0.10     0.15     0.20     0.25     0.30     0.40     0.50
  $0.00      +408     +407     +404     +404     +416     +424     +467     +430
  $0.25      +530     +528     +525     +525     +542     +560     +611     +547
  $0.50      +586     +586     +583     +583     +599    +618*    +676*    +657
  $0.75      +570     +570     +568     +568     +584     +609     +646     +657
  $1.00      +556     +556     +556     +556     +552     +562     +558     +543
  $1.50      +488     +488     +488     +488     +484     +484     +469     +480
  $2.00      +411     +411     +411     +411     +411     +411     +389     +379
```

Three observations dominate:

1. **Fees are huge.** At baseline, taker fees consumed $386 in
   profits over 760 trades — fees were larger than the net PnL.
   This is the asymmetry the new gate must filter out.
2. **`MIN_EV = $0.50` is the dollar-EV peak.** Below $0.50 we keep
   too many break-even-ish trades; above $0.50 we shed productive
   trades. Stable across all three sessions.
3. **`MIN_RR ∈ [0.30, 0.40]` is the reward-risk peak.** RR ≤ 0.20
   leaves a lot of high-fill-price trades in the population.
   RR = 0.40 (fillPrice ceiling ≈ 0.70) is the literal max but
   sits awkwardly tight given regime shift risk. RR = 0.30
   (fillPrice ceiling ≈ 0.74) lines up cleanly with the existing
   `RESEARCH_CHALLENGER_MAX_CHOSEN_BEST_ASK = 0.75` execution gate
   and captures most of the headline benefit.

## Decision

Set defaults to:

- `MIN_EXPECTED_VALUE_USD = 0.50`
- `MIN_REWARD_RISK_RATIO = 0.30`

vs the original `1.00 / 0.20` proposal:

| Setting              | Trades/session | PnL/session | PnL/trade | Win-rate |
|----------------------|----------------|-------------|-----------|----------|
| Baseline (no gate)   | 760–766        | +$155–$362  | +$0.20–$0.47 | 65.4–66.1% |
| 1.00 / 0.20 (orig.)  | 300–316        | +$556–$557  | +$1.76–$1.85 | 63.3–63.3% |
| **0.50 / 0.30 (new)**| **366–380**    | **+$618–$641**| **+$1.62–$1.69**| **64.0–64.2%** |
| 0.50 / 0.40 (peak)   | 343–361        | +$646–$676  | +$1.83–$1.88 | 64.0–64.1% |
| 2.00 / 0.20          | 146–153        | +$403–$430  | +$2.65–$2.94 | 60.7–61.4% |

`0.50 / 0.30` is +$60–$80/session better than `1.00 / 0.20` (the
original proposal) and runs ~21% more trades, with a similar
per-trade EV. `0.50 / 0.40` would squeeze another $30–$60 out but
at the cost of being more sensitive to regime shifts; tuning back
to 0.40 is a future option once we have more replay coverage.

## How to re-run

```
# Sweep against the newest replay session under tmp/replay-trading/
bun alea trading:calibrate-ev-rr-gate

# Sweep against a specific session
bun alea trading:calibrate-ev-rr-gate --session tmp/replay-trading/<session>.jsonl

# Tighter / wider grid
bun alea trading:calibrate-ev-rr-gate --ev-grid 0,0.5,1 --rr-grid 0.2,0.3,0.4
```

The command is read-only — opens one JSONL file, prints heatmaps
and summary stats. No postgres, no network. To regenerate the
underlying replay session itself,
`bun alea trading:replay --from <ISO> --to <ISO>` first.

## Addendum: 2026-05-08 re-calibration

After running prod for ~1 day on the original `MIN_EV=$0.50,
MIN_RR=0.30` defaults, lifetime PnL kept bleeding (−$501 lifetime).
Pulled fresh data covering the **24 hours ending 2026-05-08T01:00
UTC** and re-ran the sweep. Two findings:

1. **The model's raw baseline went negative** in the new window:
   234 orders, 65.0% win rate, **−$40 PnL** before any EV/RR gate.
   The May 5-7 baseline had been +$210. Either market-maker
   behaviour shifted (wider spreads → higher fillPrice avg) or the
   probability table itself has decayed.
2. **The optimum point moved.** May 5-7 was MIN_EV=$0.50; May 7-8
   is MIN_EV=$0.75:

   ```
   May 7-8 sweep (24h, 234 orders, 65% baseline win-rate, −$40 baseline PnL)
     EV≥$0.50 RR≥0.30 (old default):  72 trades, +$352, $4.89 / trade
     EV≥$0.75 RR≥0.20 (new optimum):  61 trades, +$361, $5.92 / trade  ← peak
     EV≥$1.00 RR≥0.20:                51 trades, +$298, $5.85 / trade
     EV≥$2.00 RR≥0.20:                28 trades, +$240, $8.56 / trade
   ```

The $0.75 cell was also competitive on the original May 5-7 window
(+$568 vs the $0.50 peak of +$641), so it's the more regime-robust
choice. Bumped `MIN_EXPECTED_VALUE_USD` from `0.50` → `0.75`. Kept
`MIN_REWARD_RISK_RATIO` at `0.30` (the new data shows RR=0.20 and
RR=0.30 produce identical results, so the safety-margin choice is
free).

Worth re-running this sweep periodically as the regime evolves —
a $0.10 shift in the optimum is meaningful when avg per-trade PnL
is $5.
