# Market Capture

Long-running tape recorder for the live feeds that matter to the
current dry-run and replay stack. The capture loop writes every event
as JSONL under `tmp/market-capture/`, rotates files on UTC 5-minute
boundaries, and bulk-loads closed sessions into the `market_event`
Postgres table unless `--no-ingest` is passed.

This is intentionally separate from historical candle sync. Binance
and Coinbase still exist as candle/exchange-price sources elsewhere
in the repo, but `data:capture` does not currently subscribe to their
live WebSockets.

## Running

```sh
bun alea data:capture
bun alea data:capture --assets btc,eth
bun alea data:capture --no-ingest
```

Default assets are the whitelisted Polymarket up/down universe:
`btc`, `eth`, `sol`, `xrp`, and `doge`. SIGINT / SIGTERM closes the
active writer and stream handles cleanly.

On startup, the runner scans the capture directory for orphaned
`.jsonl` files from prior runs and ingests them before opening the
new active session. Operators can also run `data:ingest-pending`
later to load sessions written with `--no-ingest`.

## Current Sources

`data:capture` currently records three source labels:

| Source                 | Stream                                                               | Event shape                                                                                                                                |
| ---------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `polymarket`           | Public market-data WS for current and next-window 5m up/down markets | Venue events (`book`, `trade`, `price-change`, `tick-size-change`, `resolved`) plus `connect`, `disconnect`, `error`, and `resync` markers |
| `pyth-spot`            | Pyth Hermes SSE price stream                                         | Synthetic BBO-shaped ticks with `bid = ask = mid = price`; raw confidence is preserved in payload                                          |
| `polymarket-chainlink` | Polymarket RTDS Chainlink reference price                            | Single-value reference ticks stored as `reference-price` events                                                                            |

Polymarket market discovery is window-scoped: the runner discovers the
current window and pre-discovers the next window 30 seconds before it
starts, then rebuilds the Polymarket subscription when the active set
changes. Pyth and Polymarket Chainlink are process-lifetime streams
that reconnect internally.

## JSONL Sessions

Each line is a `CaptureRecord`:

```ts
type CaptureRecord = {
  readonly tsMs: number;
  readonly receivedMs: number;
  readonly source: string;
  readonly asset: string | null;
  readonly kind: string;
  readonly marketRef: string | null;
  readonly payload: Record<string, unknown>;
};
```

The writer is capture-specific by design. It owns session rotation,
complete markers, pending-session recovery, and the ingest hook. A
generic JSONL helper would not know enough about those capture
semantics to be useful on its own.

Rotated sessions live at:

```txt
tmp/market-capture/YYYY-MM-DD/market-capture_YYYY-MM-DDTHH-MM-00-000Z.jsonl
```

A sibling `.complete` marker means the writer closed the file normally.
The ingester accepts both completed and orphaned JSONLs; the marker is
operator/debugging metadata, not a hard requirement.

## Persistence

`market_event` is append-only:

```txt
ts_ms        bigint
received_ms  bigint
source       text
asset        text | null
kind         text
market_ref   text | null
payload      jsonb
```

Indexes cover time scans, `(source, asset, ts_ms)` lookups, and
`market_ref` lookups for Polymarket market replay. Re-ingesting the
same JSONL is caller-side responsibility; the table intentionally does
not enforce a wide natural-key uniqueness constraint.

## Replay Notes

- `resync` means a Polymarket reconnect happened and replay code must
  reset book state before applying later diffs.
- `tsMs` is the venue/source timestamp when available. `receivedMs` is
  our local ingest clock and is the right surface for operational
  latency checks.
- Pyth and Chainlink payloads are normalized into BBO-like or
  single-value shapes so replay code can compare them without
  source-specific stream clients.
