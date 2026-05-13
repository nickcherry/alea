# Regime Paradigm Exploration Round 2 - 2026-05-13

## Scope

Tested three more replacement regime classifiers. Each one was installed as the
real `classifyMarketRegime` implementation, then the downstream state was
rebuilt with:

1. `bun alea regimes:backfill`
2. `bun alea training:run`
3. `bun alea committee:select`
4. `bun alea backtest:run`

No hybrid classifier or A/B path was introduced. After the tests, the source and
database state were restored to the current default realized-vol + linreg-trend
classifier. The restored default backtest is run `16`, matching prior baseline
run `12`.

## Results

| Paradigm | Run | WR | Scored trades | 5m WR | 15m WR | Takeaway |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Restored default: realized-vol ratio + linreg trend strength | 16 | 59.67% | 2,090 | 59.07% | 60.20% | Keeper |
| Direction persistence: same-direction close share + net ATR move | 13 | 57.81% | 1,332 | 58.06% | 57.54% | Reject: lower WR and lower volume |
| MA alignment: fast/slow SMA side + fast slope + ATR displacement | 14 | 56.17% | 3,566 | 55.47% | 56.93% | Reject: more volume, much worse quality |
| Vol percentile + signed impulse agreement | 15 | 54.13% | 460 | 55.41% | 52.84% | Reject: sparse and unstable |

## Regime Distributions

| Paradigm | Low-vol trending | Low-vol ranging | High-vol trending | High-vol ranging |
| --- | ---: | ---: | ---: | ---: |
| Restored default | 730,920 | 324,036 | 237,935 | 70,079 |
| Direction persistence | 279,819 | 775,137 | 90,629 | 217,385 |
| MA alignment | 672,210 | 382,746 | 222,195 | 85,819 |
| Vol percentile + signed impulse | 469,998 | 533,475 | 181,922 | 177,575 |

## Notes

Direction persistence was meaningfully different from the default trend read. It
moved a large amount of market history into ranging buckets and cut backtest
volume by about 36%. Low-vol-ranging was decent at 61.93%, but most activity
landed in high-vol-ranging at only 54.31%, so the aggregate could not compete.

MA alignment created a plausible-looking distribution and plenty of trades, but
it badly damaged the high-vol-ranging slice: 43.14% on 255 scored trades. The
larger trade count was not useful because it came with a 3.5 point WR loss.

Vol percentile + signed impulse produced extremely attractive training rosters
in some narrow buckets, including several near-100% selected candidates, but the
holdout exposed that as slice over-selection. It produced only 460 scored trades
and missed badly, especially on 15m and high-vol-ranging.

## Conclusion

None of the three additional paradigms beats or even approaches the current
default. The default realized-vol + linreg-trend classifier remains the best
tested regime system.

The bigger lesson from this second round is that wholesale regime replacements
are not currently the high-leverage path. The failures are not just minor tuning
misses: two of the three changed the trade surface substantially and still lost
several win-rate points. The next useful work should be targeted inside the
existing default regimes, especially where the current system is weakest, rather
than continuing to rename the whole market state map.
