import {
  fetchExactFiveMinuteBar,
  fetchRecentFiveMinuteBars,
} from "@alea/lib/livePrices/pyth/fetchRecentFiveMinuteBars";
import { streamPythHermes } from "@alea/lib/livePrices/pyth/streamPythHermes";
import type { LivePriceSource } from "@alea/lib/livePrices/source";
import type {
  LivePriceFeedHandle,
  LivePriceFeedParams,
} from "@alea/lib/livePrices/types";
import type { Asset } from "@alea/types/assets";

const FIVE_MINUTES_MS = 5 * 60 * 1000;

/**
 * Delay after each window-close before we poll Pyth Benchmarks for
 * the just-closed 5m bar. ~3s is well under the live runner's
 * `WINDOW_SUMMARY_DELAY_MS` (8s), and matches what `coinbaseSpot`
 * uses for its REST poll.
 */
const BAR_POLL_DELAY_MS = 3_000;

/**
 * Trader-side adapter around the Pyth Hermes price stream + a
 * synthetic bar-close emitter.
 *
 * Pyth has no native closed-bar event (the SSE stream is per-tick
 * aggregate prices, not OHLC). Same problem as Coinbase Advanced
 * Trade — and same fix: spawn a 5-min polling timer that fetches
 * the just-closed bar via the Pyth Benchmarks TradingView shim and
 * dispatches it to the caller. The runner's REST-fallback code
 * (`ensureTrackersReadyForWindow`) acts as the safety net if a poll
 * misses.
 *
 * Why pyth-spot at all: empirical work (2026-05-09) showed the Pyth
 * multi-publisher median disagrees with Chainlink — the venue
 * Polymarket settles on — only 1.89% of the time across 70h of
 * captured 5m windows, vs 3.31% for coinbase-spot, the prior live
 * tick source. Pyth's reporter-median architecture is structurally
 * the closest free analog of Chainlink Data Streams, so the live
 * tick now reads from the feed that most closely tracks settlement
 * truth. See scripts/source_vs_chainlink.ts.
 */
export const pythLivePriceSource: LivePriceSource = {
  id: "pyth-spot",
  stream: ({
    assets,
    onTick,
    onBarClose,
    onConnect,
    onDisconnect,
    onError,
  }: LivePriceFeedParams): LivePriceFeedHandle => {
    const tickHandle = streamPythHermes({
      assets,
      onTick: (tick) => {
        // Pyth gives a single aggregate price + confidence, not a BBO.
        // Downstream only consumes `mid`, so collapse bid/ask to the
        // same value rather than synthesising a virtual spread from
        // `conf` (which would mean different things in different
        // contexts and mislead any future consumer that read it as a
        // depth signal).
        onTick({
          asset: tick.asset,
          bid: tick.price,
          ask: tick.price,
          mid: tick.price,
          exchangeTimeMs: tick.publishTimeMs,
          receivedAtMs: tick.receivedAtMs,
        });
      },
      onConnect,
      onDisconnect,
      onError: (error) => {
        onError?.(error);
      },
    });

    let stopped = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleNextPoll = (): void => {
      if (stopped) {
        return;
      }
      const nowMs = Date.now();
      const nextWindowEnd =
        Math.floor(nowMs / FIVE_MINUTES_MS) * FIVE_MINUTES_MS +
        FIVE_MINUTES_MS;
      const delayMs = Math.max(
        BAR_POLL_DELAY_MS,
        nextWindowEnd - nowMs + BAR_POLL_DELAY_MS,
      );
      pollTimer = setTimeout(() => {
        void pollAllAssets({ openTimeMs: nextWindowEnd - FIVE_MINUTES_MS });
      }, delayMs);
    };
    const pollAllAssets = async ({
      openTimeMs,
    }: {
      readonly openTimeMs: number;
    }): Promise<void> => {
      try {
        await Promise.all(
          assets.map(async (asset) => {
            try {
              const bar = await fetchExactFiveMinuteBar({ asset, openTimeMs });
              if (bar !== null) {
                onBarClose({
                  asset: bar.asset,
                  openTimeMs: bar.openTimeMs,
                  closeTimeMs: bar.closeTimeMs,
                  open: bar.open,
                  high: bar.high,
                  low: bar.low,
                  close: bar.close,
                });
              }
            } catch (error) {
              onError?.(error as Error);
            }
          }),
        );
      } finally {
        scheduleNextPoll();
      }
    };
    scheduleNextPoll();

    return {
      stop: async () => {
        stopped = true;
        if (pollTimer !== null) {
          clearTimeout(pollTimer);
          pollTimer = null;
        }
        await tickHandle.stop();
      },
    };
  },
  fetchRecentFiveMinuteBars: ({
    asset,
    count,
    signal,
  }: {
    readonly asset: Asset;
    readonly count: number;
    readonly signal?: AbortSignal;
  }) => fetchRecentFiveMinuteBars({ asset, count, signal }),
  fetchExactFiveMinuteBar: ({
    asset,
    openTimeMs,
    signal,
  }: {
    readonly asset: Asset;
    readonly openTimeMs: number;
    readonly signal?: AbortSignal;
  }) => fetchExactFiveMinuteBar({ asset, openTimeMs, signal }),
};
