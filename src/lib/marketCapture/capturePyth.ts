import type { StreamHandle } from "@alea/lib/exchangePrices/types";
import { pythPriceFeedIds } from "@alea/lib/livePrices/pyth/pythPriceFeedIds";
import { streamPythHermes } from "@alea/lib/livePrices/pyth/streamPythHermes";
import type { CaptureSink } from "@alea/lib/marketCapture/captureSink";
import type { Asset } from "@alea/types/assets";

/**
 * Wires the Pyth Hermes SSE price stream into the capture pipeline.
 * Pyth gives a single multi-publisher aggregate price (no BBO depth),
 * so we collapse `bid = ask = mid` to keep the on-disk shape
 * compatible with replay consumers that expect BBO-like ticks. The
 * raw `conf` (Pyth's 1σ confidence band) is preserved in the payload
 * as an extra field for diagnostics.
 *
 * Captured under `source = "pyth-spot"` so replay can opt in via
 * `--tick-source pyth-spot` once data is on disk.
 */
export function capturePyth({
  assets,
  sink,
}: {
  readonly assets: readonly Asset[];
  readonly sink: CaptureSink;
}): StreamHandle {
  const handle = streamPythHermes({
    assets,
    onTick: (tick) => {
      sink({
        tsMs: tick.publishTimeMs,
        receivedMs: tick.receivedAtMs,
        source: "pyth-spot",
        asset: tick.asset,
        kind: "bbo",
        marketRef: pythPriceFeedIds[tick.asset],
        payload: {
          bid: tick.price,
          ask: tick.price,
          mid: tick.price,
          conf: tick.conf,
          tsExchangeMs: tick.publishTimeMs,
        },
      });
    },
    onConnect: () => {
      const nowMs = Date.now();
      sink({
        tsMs: nowMs,
        receivedMs: nowMs,
        source: "pyth-spot",
        asset: null,
        kind: "connect",
        marketRef: null,
        payload: {},
      });
    },
    onDisconnect: (reason) => {
      const nowMs = Date.now();
      sink({
        tsMs: nowMs,
        receivedMs: nowMs,
        source: "pyth-spot",
        asset: null,
        kind: "disconnect",
        marketRef: null,
        payload: { reason },
      });
    },
    onError: (error) => {
      const nowMs = Date.now();
      sink({
        tsMs: nowMs,
        receivedMs: nowMs,
        source: "pyth-spot",
        asset: null,
        kind: "error",
        marketRef: null,
        payload: { message: error.message },
      });
    },
  });

  return {
    stop: () => handle.stop(),
  };
}
