# Regimes

## Purpose

A **regime** is a multi-class partition of 5m windows by current market
context — trend, volatility, momentum, or short-term carry. The training
side computes a separate hold-rate surface per regime; the live trading
side looks up which regime each algo classifies the current snapshot
into and trades on the highest-edge `(algo, regime)` read available.

Regimes replaced the earlier binary survival-filter framework as the
primary live decision axis. Filters still compute on the dashboard for
diagnostic comparison (without a LIVE badge), but they no longer feed
the persisted probability table — see
[Relationship to filters](#relationship-to-filters).

## Anatomy of a regime algo

A `RegimeAlgo` is a pure classifier: same input shape used by both the
offline snapshot pipeline and the live decision path, so the two paths
can never silently desync. The contract is in
[`regimeAlgos/types.ts`](../src/lib/training/regimeAlgos/types.ts). Each
algo declares:

- **`id`** — stable snake_case identifier persisted into the probability
  table and cache keys. Don't rename once live.
- **`displayName`** / **`description`** — dashboard labels.
- **`version`** — bump when `classify` produces materially different
  output for the same input. Cache invalidates per-algo on this.
- **`regimes`** — the exhaustive ordered list of labels the classifier
  can emit. The dashboard renders columns in this order; the
  probability-table generator allocates one surface per label.
- **`classify(input) → label | null`** — pure function. Returns `null`
  during warmup or on degenerate inputs (e.g. `atr14 <= 0`); the
  framework counts that as a skip rather than a default bucket.
- **`params`** — free-form parameter snapshot for display.

### Inputs

The same `RegimeClassifierInput` is computed offline (per snapshot
context) and live (from a rolling 5m bars buffer). Adding a new algo
that consumes any of these costs zero per-input wiring:

| Field             | Source                                        |
| ----------------- | --------------------------------------------- |
| `leadingSide`     | `up` if snapshot price ≥ window open, else `down` |
| `ema20` / `ema50` | EMAs of 5m closes                             |
| `atr14` / `atr50` | Wilder ATR of 5m bars (current vol / baseline) |
| `atr3`            | Wilder ATR of 5m bars — fast vol shock signal |
| `rsi14`           | 14-period RSI on 5m closes                    |
| `prev5mDirection` | Direction of the most recent completed 5m bar |

`null` on any field signals "not seeded yet"; algos that need a missing
input return `null` from `classify` and the snapshot is skipped.

### Skip semantics

A skipped snapshot counts toward `snapshotsSkipped` but never toward
any regime's surface — coverage stays honest. This matches the binary
filter framework's `"skip"` branch.

## Active algo set

The dashboard's active set is the array exported from
[`regimeAlgos/registry.ts`](../src/lib/training/regimeAlgos/registry.ts).
Adding a new algo is one file under `regimeAlgos/` plus one line in the
registry — it auto-joins live trading at the next probability-table
generation if any of its regimes lead.

| Algo id            | Buckets                                     | What it splits on |
| ------------------ | ------------------------------------------- | ----------------- |
| `vol_only_2`       | `low_vol`, `high_vol`                       | ATR-14 ÷ ATR-50, cut at 1.0 |
| `vol_only_2_tight` | `low_vol`, `high_vol`                       | Tighter ATR-14 ÷ ATR-50 cut |
| `vol_only_2_atr3`  | `low_vol`, `high_vol`                       | ATR-3 ÷ ATR-50 — faster vol response |
| `vol_only_3`       | `low_vol`, `mid_vol`, `high_vol`            | ATR-14 ÷ ATR-50, cuts at 0.7 / 1.3 |
| `vol_quartiles_4`  | `vol_q1_lowest` … `vol_q4_highest`          | ATR-14 ÷ ATR-50, quartile-style cuts (0.6 / 1.0 / 1.5) |
| `trend_x_vol_6`    | `{no/with/against}_trend_{low/high}_vol`    | Trend (EMA20−EMA50 ÷ ATR14) × vol |
| `trend_strength_3` | `no_trend`, `weak_trend`, `strong_trend`    | Magnitude of `\|EMA20−EMA50\| ÷ ATR14`, direction-agnostic |
| `trend_only_3`     | `no_trend`, `with_trend`, `against_trend`   | Trend direction relative to leading side |
| `prev_bar_carry_2` | `with_carry`, `against_carry`               | Whether leading side aligns with previous 5m bar's direction |
| `rsi_3`            | `oversold`, `neutral`, `overbought`         | RSI-14 cuts at 30 / 70 |

**Note on `rsi_3`:** the live runner currently passes `rsi14: null`, so
this algo can't auto-promote to the persisted live table until a live
RSI tracker is wired into `RegimeTrackers`. Until then it's strictly a
dashboard comparison algo.

## Auto-promotion to live

The probability-table generator
([`bin/trading/genProbabilityTable.ts`](../src/bin/trading/genProbabilityTable.ts))
walks every algo in `LIVE_TRADING_REGIME_ALGOS`, partitions snapshots
by regime, computes each regime's average hold-rate lead vs the
unconditional baseline, and persists a `LeadingRegimeTable` for any
regime whose lead clears `LEADING_REGIME_MIN_LEAD_PP` (1.0pp today).

- **Lagging or tied regimes are excluded entirely.** The decision
  evaluator skips an algo's contribution when the snapshot's regime
  under that algo isn't in the persisted table.
- **Per-cell sample floor** is `REGIME_CELL_MIN_SAMPLES` (400 today).
  Buckets thinner than that are dropped before the lead-PP averaging
  step. This is a single shared floor across chart visibility,
  `avgLeadPp` aggregation, gen-table determination, and the live
  table — so the dashboard, gen-time filter, and persisted artifact
  all agree on which cells are trustworthy.
- **Sweet-spot restriction** — each persisted surface is restricted to
  the bp range that captures most of the regime's information gain
  (same algorithm as the legacy filter framework's sweet spot). The
  rationale and threshold tuning is in
  [the sweet-spot research note](./research/2026-05-04-sweet-spot.md).

Both constants live in
[`src/constants/trading.ts`](../src/constants/trading.ts) and are
worth A/B'ing if early live results suggest too-many or too-few
regimes are clearing the bar.

## Live decision path

At decision time the runner classifies the current snapshot under
every live algo, then calls
[`lookupAllProbabilities`](../src/lib/trading/lookupProbability.ts) with
a `regimesByAlgoId` map. The function iterates every persisted
`(algo, regime)` table and returns one `ProbabilityLookup` per entry
where the classified regime matches and `(remaining, distanceBp)`
resolves to a populated bucket. The decision evaluator then picks the
side with the largest edge across all `(lookup, side)` tuples — the
"any algo gives me actionable signal → trade" greedy strategy.

Concretely: a single snapshot can produce up to N reads (one per live
algo) and trade on whichever shows the strongest probability vs
market-implied. Algos that don't classify the snapshot (warmup, null
input) silently contribute nothing.

## Adding a new algo

1. Create `src/lib/training/regimeAlgos/<name>.ts` exporting a
   `RegimeAlgo` object satisfying the contract.
2. Pick `version: 1` (bump only when `classify` behaviour changes for
   the same input — the cache invalidates per-algo on this).
3. Co-locate `<name>.test.ts` covering the per-label and `null` skip
   branches.
4. Append the algo to the array in
   [`regimeAlgos/registry.ts`](../src/lib/training/regimeAlgos/registry.ts).
5. Run `bun alea training:distributions --assets btc` to regenerate the
   dashboard and confirm the new section renders. Eyeball the
   per-regime lead-PP — if one or more regimes clear 1.0pp, the algo
   will auto-join live at the next `trading:gen-probability-table`.

If the algo needs a new input (e.g. a longer-period EMA), add the
field to `RegimeClassifierInput` in
[`types.ts`](../src/lib/training/regimeAlgos/types.ts), wire the
offline snapshot context to compute it, and wire the live
`RegimeTrackers` to compute the same value from the rolling buffer.
The two paths must stay locked in step.

## Relationship to filters

The earlier binary-filter framework
([survivalFilters/](../src/lib/training/survivalFilters/)) still
computes on the dashboard but no longer feeds the persisted
probability table. Treat it as a benchmarking and research tool:

- Filters answer **yes/no per snapshot** ("is the price > 1.5 ATR from
  the line?"); regimes answer **which-of-N per window**.
- Filters are scored via `calibrationScore` against the unconditional
  baseline; regimes are evaluated by per-cell lead-PP and the
  leading-regime threshold.
- The dashboard renders filter sections for cross-checking, without
  the LIVE badge that marks production-relevant regime sections. The
  methodology is documented in
  [TRAINING_DOMAIN.md](./TRAINING_DOMAIN.md#filters-legacy-benchmarking-only).

Why the switch: regimes give a multi-class partition that scales
naturally to N algos run in parallel, where the live evaluator picks
the highest-edge read per snapshot. The single binary-filter axis
forced an a-priori "champion filter" choice and couldn't combine
multiple orthogonal signals at decision time without compounding (which
restricts the kept population and, empirically, scored worse than the
parent — see the
[filter scoring overhaul note](./research/2026-05-04-filter-scoring-overhaul.md)).

## Files

- Algo contract: [src/lib/training/regimeAlgos/types.ts](../src/lib/training/regimeAlgos/types.ts)
- Active set: [src/lib/training/regimeAlgos/registry.ts](../src/lib/training/regimeAlgos/registry.ts)
- Per-algo classifiers: [src/lib/training/regimeAlgos/](../src/lib/training/regimeAlgos/)
- Snapshot aggregator: [src/lib/training/regimeAlgos/applyRegimeAlgos.ts](../src/lib/training/regimeAlgos/applyRegimeAlgos.ts)
- Result types: [src/lib/training/regimeAlgos/resultTypes.ts](../src/lib/training/regimeAlgos/resultTypes.ts)
- Probability-table generator: [src/bin/trading/genProbabilityTable.ts](../src/bin/trading/genProbabilityTable.ts)
- Live lookup: [src/lib/trading/lookupProbability.ts](../src/lib/trading/lookupProbability.ts)
- Persisted shape: [src/lib/trading/types.ts](../src/lib/trading/types.ts) (`leadingRegimeTableSchema`)
- Tunables: [src/constants/trading.ts](../src/constants/trading.ts) (`LEADING_REGIME_MIN_LEAD_PP`, `REGIME_CELL_MIN_SAMPLES`, `LIVE_TRADING_REGIME_ALGOS`)
