# Trade Decision Default Markets 2026-05-15

## Decision

Set the no-flag dry-run/live/backtest market set to:

```text
15m/btc
5m/eth
15m/eth
15m/sol
```

The full supported surface remains `5m` and `15m` for the whitelisted
assets. Operators can still override the grid with `--assets` and
`--periods`.

## Rationale

The prior default replayed every active BTC/ETH/SOL `5m` and `15m`
slice. That produced the highest raw proxy PnL, but two `5m` slices were
thin enough that execution friction could plausibly erase them:

| slice | WR | scored | PnL |
| --- | ---: | ---: | ---: |
| 5m BTC | 53.22% | 451 | `$580` |
| 5m SOL | 53.39% | 339 | `$460` |

The adopted default keeps every stronger `15m` slice plus ETH `5m`,
which was the only strong `5m` slice.

## Persisted Backtest

After applying the default market set:

```sh
bun alea backtest:run
```

Persisted run `6`:

- Markets: `15m/btc`, `5m/eth`, `15m/eth`, `15m/sol`.
- Committee decisions: 3,115.
- Scored trades: 2,689.
- Win rate: 58.42%.
- Proxy PnL: `$9,060` at `$20` stake.

## Breakdown

| slice | WR | scored | PnL |
| --- | ---: | ---: | ---: |
| 15m BTC | 56.67% | 510 | `$1,360` |
| 5m ETH | 57.12% | 1,180 | `$3,360` |
| 15m ETH | 61.69% | 663 | `$3,100` |
| 15m SOL | 59.23% | 336 | `$1,240` |

Period totals:

| period | WR | scored | PnL |
| --- | ---: | ---: | ---: |
| 5m | 57.12% | 1,180 | `$3,360` |
| 15m | 59.44% | 1,509 | `$5,700` |

## Tradeoff

Compared with the broader run `5`, this removes 790 scored trades and
`$1,040` proxy PnL, but raises win rate from 57.26% to 58.42% and avoids
making the operational default depend on low-margin `5m` BTC/SOL.
