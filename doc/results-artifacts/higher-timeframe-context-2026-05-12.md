# Higher-Timeframe Context Research 2026-05-12

Scope: research pass on using higher timeframe candles in the current trade
committee flow. For `5m` decisions, the higher timeframe is `15m`. For `15m`
decisions, the higher timeframe is `1h`.

This is a committee decision replay over the holdout backtest window starting
`2026-04-01` and ending at the start of `2026-05-12` UTC. It uses Pyth spot
candles only and does not model Polymarket order-book fills.

Source artifacts:

- `tmp/committee-sweeps/higher-timeframe-committee-gates-targeted-20260512.json`
- `tmp/committee-sweeps/higher-timeframe-committee-gates-stress-20260512.json`
- `tmp/committee-sweeps/higher-timeframe-committee-vote-gates-20260512.json`
- `tmp/higher-timeframe-filter-lift-summary.csv`
- `tmp/higher-timeframe-filter-compound-summary.csv`
- `tmp/higher-timeframe-filter-compound-top-ge1000.csv`
- `tmp/higher-timeframe-filter-compound-top-ge500.csv`

## Executive Read

Higher timeframe context is a real lever. The useful pattern is not a global
"trend agrees" rule. The edge shows up when higher timeframe context is applied
selectively in weak/high-volatility slices:

- abstain in `high_vol_ranging`
- in `high_vol_trending`, require the higher timeframe to agree with the trade
  direction using SMA context, especially `SMA50`
- for a more selective mode, also require weak assets (`SOL`, `XRP`, `DOGE`) to
  have higher-timeframe SMA agreement

This moves win rate by more than the requested 1pp bar and often by 3pp to 5pp,
depending on volume target. Baseline was `55.02%` on `24,102` scored trades.
The prior best ungated main configs were roughly `57.3%` to `57.5%`.

## Best Tradeoffs

| volume target | config | higher-timeframe rule | win rate | scored trades | read |
| --- | --- | --- | ---: | ---: | --- |
| `>= 5k` | `strict-top20` | abstain `high_vol_ranging`; `high_vol_trending` needs SMA20 and SMA50 agreement | `58.95%` | `5,045` | best WR above 5k trades |
| `>= 5k` | `middle-volume` | abstain `high_vol_ranging`; `high_vol_trending` needs SMA20 and SMA50 agreement | `58.78%` | `5,745` | smoother main-default candidate |
| `>= 5k` | `middle-volume` | abstain `high_vol_ranging`; `high_vol_trending` needs SMA50 agreement | `58.72%` | `5,889` | similar, slightly more volume |
| `>= 4k` | `strict-main` | abstain `high_vol_ranging`; `high_vol_trending` needs SMA50 agreement | `59.28%` | `4,668` | best balanced high-WR candidate |
| `>= 3k` | `strict-main` | abstain `high_vol_ranging`; weak assets or `high_vol_trending` need SMA50 agreement | `60.26%` | `3,007` | best 60%+ practical candidate |
| `>= 2k` | `strict-main` | abstain `high_vol_ranging`; weak assets or `high_vol_trending` need SMA20 and SMA50 agreement | `60.63%` | `2,446` | high WR, selective |
| sparse | `strict-main-votes3` | same weak/high-vol SMA20 and SMA50 rule, with 3 votes | `62.50%` | `1,216` | interesting, too sparse for default |

Recommendation: if we want a main default, prefer the `middle-volume` or
`strict-top20` high-vol gate family. If we want a high-conviction selective
mode, use `strict-main` plus weak/high-vol SMA50 gating and accept roughly
`3k` trades.

## Stability Checks

The finalist gates were not one-day artifacts. All checked finalists traded on
`42` active days. Top day share stayed around `3.3%` to `4.0%`, and first-half
vs second-half win rates were close.

| config | rule | WR / trades | positive days | top day share | first half | second half |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `strict-main` | high-vol SMA50 | `59.28% / 4,668` | `38 / 42` | `3.36%` | `59.23%` | `59.32%` |
| `strict-main` | weak/high-vol SMA50 | `60.26% / 3,007` | `41 / 42` | `3.39%` | `60.67%` | `59.84%` |
| `strict-main` | weak/high-vol SMA20+SMA50 | `60.63% / 2,446` | `39 / 42` | `3.76%` | `60.93%` | `60.33%` |
| `strict-top20` | high-vol SMA20+SMA50 | `58.95% / 5,045` | `39 / 42` | `3.31%` | `58.88%` | `59.01%` |
| `middle-volume` | high-vol SMA50 | `58.72% / 5,889` | `38 / 42` | `3.29%` | `58.66%` | `58.77%` |
| `high-volume` | weak/high-vol SMA50 | `59.20% / 4,392` | `41 / 42` | `3.96%` | `59.12%` | `59.28%` |

## Period, Asset, Regime Read

The strongest practical candidates improved both periods:

- `strict-main` plus high-vol SMA50: `58.53% / 1,700` on `5m`,
  `59.70% / 2,968` on `15m`
- `strict-main` plus weak/high-vol SMA50: `60.64% / 1,067` on `5m`,
  `60.05% / 1,940` on `15m`
- `middle-volume` plus high-vol SMA50: `58.09% / 1,904` on `5m`,
  `59.02% / 3,985` on `15m`

Asset splits are acceptable but not uniform. BTC and ETH still carry the
cleanest results. The weak-asset gates improve SOL/XRP/DOGE selectivity, but
DOGE remains the least convincing asset.

The regime story is the clearest:

- `high_vol_ranging` is weak enough that abstaining is consistently helpful.
- `high_vol_trending` improves when higher timeframe SMA context agrees.
- Low-vol regimes are already good; weak-asset gates can improve them further
  but at a large volume cost.

## Vote Gate vs Decision Gate

I tested higher-timeframe gating at two points:

- final decision gate: aggregate committee votes first, then decide whether the
  higher timeframe permits the trade
- individual vote gate: apply the higher-timeframe condition to each active
  candidate vote before aggregation

For the tested directional SMA gates, the two approaches produced nearly
identical results. That means the simpler implementation is a final committee
context gate. It is easier to reason about and avoids mutating every filter's
vote semantics.

## Compound Filter Evidence

I also checked training-time filter engagements to see whether higher timeframe
context deserves to become a compound-filter input. This was not a holdout
committee replay; it is candidate-level training evidence.

Simple contexts had only one `>= 1000` engagement candidate with at least
`+5pp` lift. Compound contexts were more promising:

- `candle_oppose_and_ret3_oppose`: many `+3pp` candidates, including one
  `+5pp` at `>= 1000` engagements in both `5m` and `15m`
- `sma50_side_agree_ret3_oppose`: strongest `15m` compound context by broad
  lift count
- `sma_stack_or_sma20_slope_agree`: one `+5pp` `15m` candidate and several
  `+3pp` candidates
- `candle_oppose_and_sma50_agree`: many `+3pp` candidates and strong
  `>= 500` engagement rows, but no `>= 1000` `+5pp` rows

Read: compound filters are worth a focused follow-up, but not as the first
production change. The current committee replay already shows a clean
decision-level lever with less surface area.

## Implementation Recommendation

Do not make this a new "regime" system yet. Implement it as higher-timeframe
context available to the committee decision path:

1. Add a small helper that maps `5m -> 15m` and `15m -> 1h`.
2. Hydrate the last fully closed higher-timeframe candle available at the
   decision time.
3. Compute SMA20, SMA50, and optionally ret3/ret6 on the higher timeframe.
4. Add a configurable committee context gate with two named modes:
   - main mode: abstain in `high_vol_ranging`; in `high_vol_trending`, require
     higher-timeframe SMA50 or SMA20+SMA50 agreement
   - selective mode: also require weak assets to satisfy higher-timeframe SMA
     agreement
5. Keep period/asset/regime breakdowns in the backtest output and dashboard.

The best first production candidate is the main high-vol gate. The selective
weak/high-vol gate is attractive if we decide `3k` holdout trades is enough
volume for a high-conviction mode.
