# Trading Committee

The committee is what turns a roomful of small predictive filters
into a single trade direction. At decision time it classifies the
market regime, looks up which candidates qualified to vote in that
regime, evaluates each one on the current bar window, and takes a
simple majority of the non-abstain votes.

The same logic drives the dry-run loop today and will drive live
trading when it ships. There is no separate "live committee".

## Two phases

**Selection** runs once, offline. The `committee:select` CLI scans
regime-stratified backtest stats and writes the voter roster to a
DB table. Selection is **manual** — operator runs it after a fresh
`backtest:run` or a `regimes:backfill`.

**Evaluation** runs every 5-minute boundary, inside the dry-run /
live loop. Classify the bar's regime → look up the roster for
`(regime, period)` → evaluate each candidate → simple majority.

## Selection: eligibility + ranking

For a `(filter, config)` candidate to qualify for regime R's
committee, **within that regime** it must clear:

| Rule                       | Default | Why                                             |
| -------------------------- | ------- | ----------------------------------------------- |
| Min engagements in regime  | `≥ 20`  | Below this the WR is too noisy to act on        |
| Aggregate WR in regime     | `≥ 53%` | Proves a base-rate edge over coin-flip          |
| Worst-quarter WR in regime | `≥ 50%` | Rejects "one good year, several bad" candidates |

The worst-quarter check only applies to quarters with at least 10
engagements inside this regime. Candidates with no quarter that meaningful
skip the check (sparse + high-WR is admissible).

Defaults live in
[`DEFAULT_COMMITTEE_SELECTION_RULES`](../src/lib/committee/selection/types.ts).
The eligibility rule is the same shape for every regime — there's
no auto-relaxation for rare regimes today. If a regime ends up with
< 10 qualifiers under the current rules, the committee will be
smaller than the top-N cap.

Qualifying candidates are **ranked by Wilson 95% lower bound desc**
(with `nEngagements` desc as tie-break). Wilson LB punishes small samples
in the ranking even after they cleared the absolute eligibility
floor, so a 20-engagement 80% candidate gets admitted but ranks below a
500-engagement 60% candidate. Take the **top 10**.

Final selection: top 10 per `(market_regime, period)`. With 4
regimes × 2 periods = 8 buckets, the table holds up to 80 rows.

```sh
bun alea committee:select
```

Wipes `committee_selections` and rewrites it in a single
transaction. Selection is a single point-in-time snapshot, not a
history. `selected_at_ms` is stamped on every row so a downstream
consumer can warn when the roster is stale.

## `committee_selections` table

Schema in
[`202605120400_committee_selections`](../src/lib/db/migrations/202605120400_committee_selections.ts).

| Column                                        | Meaning                                                           |
| --------------------------------------------- | ----------------------------------------------------------------- |
| `market_regime`                               | One of the four regime tags                                       |
| `period`                                      | `5m` or `15m`                                                     |
| `filter_id`, `filter_version`, `config_canon` | Candidate identity                                                |
| `rank`                                        | 1-based position within the bucket                                |
| `n_engagements`, `n_wins`, `win_rate`         | Aggregate stats at selection time                                 |
| `wilson_low`                                  | Wilson LB used for ranking                                        |
| `worst_quarter_wr`                            | The worst quarter's WR, or null when none cleared the sample gate |
| `selected_at_ms`                              | When `committee:select` produced this row                         |

Primary key: `(market_regime, period, filter_id, filter_version, config_canon)`.
Replacing the whole table on every run is cheap (≤ 80 rows
in practice).

## Evaluation

The dry-run loop loads the table once at startup into an in-memory
roster (`(regime, period) → Set<candidateKey>`). See
[`loadCommitteeRoster`](../src/lib/committee/selection/loadCommitteeRoster.ts).

At each 5-minute boundary the loop:

1. Builds the synthetic bar window (real history + the in-flight
   bar with Pyth's t-5s price as the synthetic close).
2. Calls `classifyMarketRegime({ bars })`.
   - `null` → abstain entirely; no decision row, no engagement log.
3. Looks up the roster bucket for `(marketRegime, "5m")`.
   - Empty bucket → abstain entirely.
4. Calls `evaluateCommittee({ bars, candidates: rosterCandidates })`.
   Each candidate's `predict` runs; votes are collected.
5. Simple majority of `(up, down)` wins; tie or all-abstain → no
   decision.

[`aggregateCommittee`](../src/lib/committee/aggregate.ts) is one
function, ~15 lines: tally up/down/abstain, strict majority wins.
**No regime grouping inside the committee** — that's the selector's
job. By the time votes reach the aggregator they're already
filtered to the right regime.

Every actionable decision lands in `dry_run_decisions` with the regime
tag, the up/down/abstain tally, and the synthetic-open price. See
[DRY_RUN.md](./DRY_RUN.md).

## Refresh contract

Selection is **manual on purpose**. Re-running `committee:select`
swaps the live voter roster — the dry-run loop won't pick up the
change until it restarts. Sequence after a new backtest:

```sh
bun alea backtest:run          # write filter_engagements
bun alea regimes:backfill      # if classifier or candle set changed
bun alea committee:select      # rebuild roster from fresh stats
# restart any running dry-run process to pick up new roster
```

There is no auto-refresh. The reasoning: roster changes are
significant — they alter who can vote on real money. Operator
should see the diff and re-launch deliberately.

## Live vs dry-run

The committee logic is **identical**. The only difference between
modes is what happens with an actionable decision:

- Dry-run today: persist to `dry_run_decisions`, no order placed.
- Live (when it ships): the same persistence plus a maker order on
  Polymarket at ~50¢. The committee path is unchanged.

The implication for testing: anything that's safe to validate
against the dry-run loop will behave identically in live trading.

## Files

- [`src/lib/committee/aggregate.ts`](../src/lib/committee/aggregate.ts) —
  simple-majority aggregator. Pure.
- [`src/lib/committee/runCommittee.ts`](../src/lib/committee/runCommittee.ts) —
  `evaluateCommittee` — runs each candidate's `predict` on a bar
  window, returns the aggregated decision + per-candidate vote log.
- [`src/lib/committee/types.ts`](../src/lib/committee/types.ts) —
  `CandidateVote`, `CommitteeDecision`.
- [`src/lib/committee/selection/`](../src/lib/committee/selection/) —
  eligibility rules, the pure selector, the regime-stats loader,
  the roster loader, and persistence.
- [`src/bin/committee/select.ts`](../src/bin/committee/select.ts) —
  the `committee:select` CLI.
- [`src/lib/db/migrations/202605120400_committee_selections.ts`](../src/lib/db/migrations/202605120400_committee_selections.ts) —
  schema.
