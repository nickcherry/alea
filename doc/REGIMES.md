# Market Regimes

Every bar in the canonical pyth-spot candle series is tagged with a
**market regime** — the classifier's read of "what kind of market
were we in when this bar closed". Regime tags drive two things:

- The exploration dashboard stratifies filter performance by regime
  so we can see "this config is 56% overall but 70% in `low_vol_ranging`".
- The committee picks a different voter roster per regime; the
  dry-run loop classifies the current bar and only lets relevant
  candidates vote. See [COMMITTEE.md](./COMMITTEE.md).

A regime is **about the market state**, not about a filter's
strategy family. The `regime` field on a `Filter` object is unrelated
(it tags the filter family — see [FILTERS.md](./FILTERS.md)).

## Tag set

A 2×2 of volatility × directionality:

```
low_vol_trending     low_vol_ranging
high_vol_trending    high_vol_ranging
```

Defined in
[`src/lib/regime/types.ts`](../src/lib/regime/types.ts). Adding a
fifth tag means a migration update on `bar_regimes.market_regime`
and `committee_selections.market_regime` check constraints — both
in [`src/lib/db/migrations/`](../src/lib/db/migrations/).

## Classifier

[`classifyMarketRegime`](../src/lib/regime/classify.ts) takes a
trailing bar window and returns a `MarketRegime | null`. Two cheap
computations, both gated on having at least 100 prior bars:

**Volatility axis** — log-return realised vol of the last 20 bars
vs the median realised vol across the last 100 bars (rolling 20-bar
windows). Ratio > 1.3 → `high_vol`; otherwise `low_vol`. A wider
band keeps the regime from whipping every couple bars.

**Directionality axis** — `|linreg slope × 20| / ATR(20)` — i.e.
how many ATRs the regression line travels over the 20-bar window. >
1.2 → `trending`; otherwise `ranging`.

When the window is shorter than 100 bars the classifier returns
`null`. Downstream consumers treat `null` as "don't know" — the
exploration loader drops those bars, the dry-run loop abstains.

Thresholds (`HIGH_VOL_RATIO=1.3`, `TREND_THRESHOLD=1.2`,
`BASELINE_BARS=100`, `RECENT_BARS=20`) live as named constants at
the top of the file. Tuning them invalidates downstream selections
— after a change, run `regimes:backfill` and `committee:select`
before the next dry-run.

## Persistence: `bar_regimes`

A first-class table, **not** computed on the fly. One row per
`(asset, period, ts_ms)`:

```
asset          text
period         text         5m or 15m
ts_ms          bigint       bar open-time
market_regime  text | null  one of 4 tags, or null at series start
```

Schema:
[`202605120300_bar_regimes`](../src/lib/db/migrations/202605120300_bar_regimes.ts).
The exploration dashboard's per-regime aggregator joins
`filter_engagements` against this table on
`(asset, period, ts_ms)` to bucket fires. The committee selection
command does the same.

Backfilling is a one-shot CLI:

```sh
bun alea regimes:backfill
```

It walks each `(asset, period)` series in chronological order,
calls `classifyMarketRegime` on a 100-bar trailing window, and
upserts into `bar_regimes`. Idempotent — re-running after a
classifier change overwrites every existing row.

Current distribution on 5m + 15m combined (~1.36M bars total):

| Regime | Share |
|---|---|
| `low_vol_trending` | 54% |
| `low_vol_ranging` | 24% |
| `high_vol_trending` | 17% |
| `high_vol_ranging` | 5% |
| `null` (early-history) | 0.07% |

That's a real asymmetry in the data, not a calibration accident.
Crypto on 5m bars is mostly "low vol drifting somewhere" with rare
high-vol ranging windows.

## Live classification

The dry-run loop calls the same `classifyMarketRegime` function at
decision time — see
[`runDryRun.ts`](../src/lib/dryRun/runDryRun.ts). The 150-bar
hydration buffer on startup is wider than the classifier's 100-bar
window, so the first decision always classifies. If the buffer is
ever shorter than 100 bars (only possible in an unrealistic edge
case), the loop logs an abstain and skips the decision.

The result is stored on every `dry_run_decisions` row as
`market_regime`. The dashboard slices win rate by that column so we
can see "we hit 62% in low_vol_ranging but only 49% in
high_vol_trending overnight."

## Files

- [`src/lib/regime/types.ts`](../src/lib/regime/types.ts) — the
  `MarketRegime` union.
- [`src/lib/regime/classify.ts`](../src/lib/regime/classify.ts) —
  the classifier.
- [`src/lib/db/migrations/202605120300_bar_regimes.ts`](../src/lib/db/migrations/202605120300_bar_regimes.ts) —
  schema.
- [`src/bin/regimes/backfill.ts`](../src/bin/regimes/backfill.ts) —
  the backfill CLI.
