# Trading Committee

The committee is what turns a roomful of small predictive filters
into a single trade direction. At decision time it classifies the
market regime, looks up which candidates qualified to vote in that
asset/regime bucket, evaluates each one on the current bar window,
and takes a trade decision from the filtered vote tally.

The same logic drives the dry-run loop today and will drive live
trading when it ships. There is no separate "live committee".

## Two phases

**Selection** runs once, offline. The `committee:select` CLI scans
asset/regime-stratified training stats for the active training profile
and writes the voter roster to a DB table tagged with that same profile.
Selection is **manual** — operator runs it after a fresh
`training:run` pass or a `regimes:backfill`.

**Evaluation** runs at each configured trade-decision boundary,
inside the dry-run / live loop. The no-flag default market set is
the full BTC/ETH/SOL/XRP/DOGE `5m` + `15m` surface; the CLI can override the
asset/period grid. Classify the bar's regime → look up the roster for
`(asset, regime, period)` → evaluate each candidate → apply the shared vote
policy. Regime is an analysis/bucketing dimension, not a high/low-vol trade
gate.

## Selection: eligibility + ranking

For a `(filter, config)` candidate to qualify for asset A and regime R's
committee, **within that asset/regime bucket** it must clear the base
rules, then any matching scoped override:

| Rule                             | Default   | Why                                                      |
| -------------------------------- | --------- | -------------------------------------------------------- |
| Min engagements in asset/regime  | `≥ 80`    | Below this the WR is too noisy to act on                 |
| Aggregate WR in asset/regime     | `≥ 53.8%` | Proves a base-rate edge over coin-flip                   |
| Worst-quarter WR in asset/regime | `≥ 52%`   | Rejects "one good year, several bad" candidates          |
| Top distinct filters per bucket  | `≤ 12`    | Keeps lower-ranked marginal voters out of live decisions |

The worst-quarter check only applies to quarters with at least 40
engagements inside this asset/regime bucket. Candidates with no quarter that meaningful
skip the check (sparse + high-WR is admissible).

Defaults live in
[`DEFAULT_COMMITTEE_SELECTION_PROFILE`](../src/lib/committee/selection/types.ts).
Sweep experiments over these knobs live in
[`SWEEPING.md`](./SWEEPING.md) and should be run through
`bun alea backtest:sweep-committee` rather than by editing constants
between trials.

The current default uses no scoped asset/period overrides. The live
OpenAI decision path trades the full BTC/ETH/SOL/XRP/DOGE `5m` + `15m`
surface.

There is no global fallback roster. If a bucket has fewer qualifiers
than its top-N cap, that bucket's committee is simply smaller than the
cap; if it has none, that asset/regime abstains.

Qualifying candidates are **ranked by Wilson 95% lower bound desc**
(with `nEngagements` desc as tie-break). Wilson LB punishes small samples
in the ranking even after they cleared the absolute eligibility
floor, so a 90-engagement 80% candidate gets admitted but ranks below a
500-engagement 60% candidate. For each `filter_id`, keep only the
highest-ranked config, then take the bucket's configured top-N distinct
filters.

Final selection: top-N distinct filters per `(asset, market_regime, period)`.
With the current base cap, the table usually holds about 365 rows.

```sh
bun alea committee:select
```

Wipes `committee_selections` and rewrites it in a single
transaction. Selection is a single point-in-time snapshot, not a
history. `selected_at_ms` is stamped on every row so a downstream
consumer can warn when the roster is stale.

## `committee_selections` table

Schema in
[`202605121400_asset_scoped_committee_selections`](../src/lib/db/migrations/202605121400_asset_scoped_committee_selections.ts).

| Column                                        | Meaning                                                           |
| --------------------------------------------- | ----------------------------------------------------------------- |
| `training_profile`                            | Outcome-label + research-window identity used to select the row   |
| `asset`                                       | Crypto asset for this roster bucket                               |
| `market_regime`                               | One of the four regime tags                                       |
| `period`                                      | `5m` or `15m`                                                     |
| `filter_id`, `filter_version`, `config_canon` | Candidate identity                                                |
| `rank`                                        | 1-based position within the bucket                                |
| `n_engagements`, `n_wins`, `win_rate`         | Aggregate stats at selection time                                 |
| `wilson_low`                                  | Wilson LB used for ranking                                        |
| `worst_quarter_wr`                            | The worst quarter's WR, or null when none cleared the sample gate |
| `selected_at_ms`                              | When `committee:select` produced this row                         |

Primary key: `(asset, market_regime, period, filter_id, filter_version, config_canon)`.
Replacing the whole table on every run is cheap (≤ 625 rows
in practice).

Dry-run/live loaders only read rows whose `training_profile` matches
the active constant. When the training window or outcome-label rule
changes, the old roster intentionally disappears until the operator
rebuilds training artifacts and runs `committee:select`.

## Evaluation

The dry-run loop loads the table once at startup into an in-memory
roster (`(asset, regime, period) → selected candidate keys + stats`). See
[`loadCommitteeRoster`](../src/lib/committee/selection/loadCommitteeRoster.ts).

At each configured period boundary the loop:

1. Builds the synthetic bar window (real history + the in-flight
   bar with Pyth's lead-time price as the synthetic close).
2. Calls `classifyMarketRegime({ bars })`.
   - `null` → abstain entirely; no decision row, no engagement log.
3. Checks `TRADE_DECISION_ALLOWED_MARKET_REGIMES`.
   - Disallowed regime → abstain entirely.
4. Looks up the roster bucket for `(asset, marketRegime, period)`.
   - Empty bucket → abstain entirely.
5. Calls `evaluateCommittee({ bars, candidates: rosterCandidates })`.
   Each selected candidate config's `predict` runs; votes are
   collected with the selection-time win rate.
6. Collapse to at most one active vote per `filter_id`. If multiple
   configs for the same filter engage, the engaged config with the
   highest selected asset/regime `win_rate` is the one that counts. Abstain
   configs do not block a lower-WR engaged config for the same filter.
7. Apply the trade decision constants: minimum non-abstain votes,
   consensus fraction, and tie handling.

[`aggregateCommittee`](../src/lib/committee/aggregate.ts) is the
shared policy function. It has no dry-run-specific behavior. Live
trading must call the same evaluator/aggregator before placing an
order so dry-run and live voting stay identical.

## Trade decision constants

Critical decision settings live in
[`src/constants/tradeDecision.ts`](../src/constants/tradeDecision.ts).

| Constant                                |                                     Default | Meaning                                                                             |
| --------------------------------------- | ------------------------------------------: | ----------------------------------------------------------------------------------- |
| `TRADE_DECISION_DEFAULT_MARKETS`        | full BTC/ETH/SOL/XRP/DOGE `5m` + `15m` grid | No-flag dry-run/live/backtest market set                                            |
| `TRADE_DECISION_DEFAULT_PERIODS`        |                                   `5m, 15m` | Period fallback when an operator overrides only assets                              |
| `TRADE_DECISION_DEFAULT_ASSETS`         |                  `btc, eth, sol, xrp, doge` | Asset fallback when an operator overrides only periods                              |
| `TRADE_DECISION_SUPPORTED_PERIODS`      |                                   `5m, 15m` | Periods supported by committee/dry-run persistence                                  |
| `TRADE_DECISION_ALLOWED_MARKET_REGIMES` |                      all classified regimes | Regimes recorded for analysis; not a high/low-vol trade gate                        |
| `TRADE_DECISION_LEAD_TIME_BY_PERIOD_MS` |                   `5m=120000`, `15m=180000` | Snapshot/live decision lead before target candle open                               |
| `TRADE_DECISION_HYDRATE_BARS`           |                                       `150` | Closed bars loaded before the loop starts                                           |
| `MAX_COMMITTEE_VOTES_PER_FILTER`        |                                         `1` | One active vote per `filter_id`, even if multiple configs engage                    |
| `MIN_COMMITTEE_VOTES_TO_TRADE`          |                                         `2` | Minimum non-abstain votes after filter collapse                                     |
| `MIN_COMMITTEE_CONSENSUS_FRACTION`      |                                       `0.5` | Winning side must hold at least this share; ties still abstain                      |
| `TRADE_DECISION_FILTER_TIE_BREAK`       |                                  highest WR | Same-filter engaged configs rank by win rate, then engagements, then selection rank |

With the current constants, the final decision is simple majority
after filter-level vote collapse, with at least two engaged filters
required. Changing `MIN_COMMITTEE_VOTES_TO_TRADE` changes that for both
dry-run and live. Changing `TRADE_DECISION_DEFAULT_MARKETS` changes the
no-flag default market set for committee backtest, dry-run, and live.
`TRADE_DECISION_ALLOWED_MARKET_REGIMES` now includes every classified
regime so high/low-vol labels do not block trades.

Every actionable decision lands in `dry_run_decisions` with the regime
tag, the up/down/abstain tally, and the synthetic-open price. See
[DRY_RUN.md](./DRY_RUN.md).

## Refresh contract

Selection is **manual on purpose**. Re-running `committee:select`
swaps the live voter roster — the dry-run loop won't pick up the
change until it restarts. Sequence after refreshing training artifacts:

```sh
bun alea training:run          # write training artifacts
bun alea regimes:backfill      # if classifier or candle set changed
bun alea committee:select      # rebuild roster from fresh stats
bun alea backtest:run          # replay roster over the holdout window
# restart any running dry-run process to pick up new roster
```

There is no auto-refresh. The reasoning: roster changes are
significant — they alter who can vote on real money. Operator
should see the diff and re-launch deliberately.

## Live vs dry-run

The committee logic is **identical**. The only difference between
modes is what happens with an actionable decision:

- Dry-run today: persist to `dry_run_decisions`, no real order placed.
- Dry-run execution simulation: the same persisted decision plus a
  pretend pre-open Polymarket order whose fill status is tracked.
- Live: the same decision path plus real post-only maker order
  placement through `trading:run`. The committee path is unchanged.
  Live trading does not persist local trade/fill rows after order
  creation; Polymarket remains the source of truth.

The implication for testing: anything that's safe to validate
against the dry-run loop will behave identically in live trading.

## Committee backtest

`bun alea backtest:run` sits between roster construction and dry-run.
It uses the holdout window from
[`src/constants/researchWindows.ts`](../src/constants/researchWindows.ts),
replays the selected committee over aligned historical Pyth/Coinbase
spot candles, and scores directional prediction quality against Pyth
outcomes. It does not connect to Polymarket or simulate order-book
fills; those questions belong to dry-run. The point is fast iteration
on consensus, vote weighting, and position-sizing policy before
testing live-like execution.

## Files

- [`src/lib/committee/aggregate.ts`](../src/lib/committee/aggregate.ts) —
  shared trade-decision vote policy. Pure.
- [`src/lib/committee/runCommittee.ts`](../src/lib/committee/runCommittee.ts) —
  `evaluateCommittee` — runs each candidate's `predict` on a bar
  window, returns the aggregated decision + per-candidate vote log.
- [`src/lib/committee/types.ts`](../src/lib/committee/types.ts) —
  `CandidateVote`, `CommitteeDecision`.
- [`src/constants/tradeDecision.ts`](../src/constants/tradeDecision.ts) —
  decision-period, lead-time, one-vote-per-filter, vote-count, and
  consensus constants.
- [`src/lib/committee/selection/`](../src/lib/committee/selection/) —
  eligibility rules, the pure selector, the regime-stats loader,
  the roster loader, and persistence.
- [`src/bin/committee/select.ts`](../src/bin/committee/select.ts) —
  the `committee:select` CLI.
- [`src/lib/db/migrations/202605121400_asset_scoped_committee_selections.ts`](../src/lib/db/migrations/202605121400_asset_scoped_committee_selections.ts) —
  schema.
