# Trade Decision Default Markets 2026-05-15

## Decision

Set the no-flag dry-run/live/backtest market set to the full
BTC/ETH/SOL `5m` + `15m` surface:

```text
5m/btc
15m/btc
5m/eth
15m/eth
5m/sol
15m/sol
```

Pair this with the current top-12 committee selection cap. The full
supported trading surface remains `5m` and `15m` for the whitelisted
assets, and operators can still override the grid with `--assets` and
`--periods`.

## Rationale

The prior narrow default removed `5m` BTC/SOL because the top-18 roster
made those slices too marginal. A follow-up vote-shape sweep showed the
problem was mostly the lower-ranked voter tail, not the markets
themselves.

Using `topN = 12` restores the broader surface while improving the
default replay versus the narrow market set:

| default                          |     WR | scored |      PnL |
| -------------------------------- | -----: | -----: | -------: |
| Prior narrow top18 run `6`       | 58.42% |  2,689 | `$9,060` |
| Current all-market top12 run `7` | 58.66% |  2,719 | `$9,420` |

The full top-18 all-market profile still had higher raw proxy PnL
(`$10,100`), but its 57.26% WR depended on weak low-margin tails. The
top-12 cap is the better operational default.

## Persisted Backtest

After applying the default market set and rebuilding selection:

```sh
bun alea committee:select
bun alea backtest:run
```

Persisted run `7`:

- Markets: `5m/btc`, `15m/btc`, `5m/eth`, `15m/eth`, `5m/sol`, `15m/sol`.
- Committee roster: 366 rows.
- Committee decisions: 3,181.
- Scored trades: 2,719.
- Win rate: 58.66%.
- Proxy PnL: `$9,420` at `$20` stake.

## Breakdown

| slice   |     WR | scored |      PnL |
| ------- | -----: | -----: | -------: |
| 5m BTC  | 55.93% |    329 |   `$780` |
| 15m BTC | 57.35% |    476 | `$1,400` |
| 5m ETH  | 59.00% |    800 | `$2,880` |
| 15m ETH | 62.50% |    552 | `$2,760` |
| 5m SOL  | 53.25% |    246 |   `$320` |
| 15m SOL | 60.13% |    316 | `$1,280` |

Period totals:

| period |     WR | scored |      PnL |
| ------ | -----: | -----: | -------: |
| 5m     | 57.24% |  1,375 | `$3,980` |
| 15m    | 60.12% |  1,344 | `$5,440` |

Asset totals:

| asset |     WR | scored |      PnL |
| ----- | -----: | -----: | -------: |
| BTC   | 56.77% |    805 | `$2,180` |
| ETH   | 60.43% |  1,352 | `$5,640` |
| SOL   | 57.12% |    562 | `$1,600` |
