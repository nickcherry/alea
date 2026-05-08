import { streamCoinbaseSpotQuotes } from "@alea/lib/exchangePrices/sources/coinbase/streamCoinbaseSpotQuotes";
import {
  fetchExactFiveMinuteBar,
  fetchRecentFiveMinuteBars,
} from "@alea/lib/livePrices/coinbaseSpot/fetchRecentFiveMinuteBars";
import type { LivePriceSource } from "@alea/lib/livePrices/source";
import type {
  LivePriceFeedHandle,
  LivePriceFeedParams,
} from "@alea/lib/livePrices/types";
import type { Asset } from "@alea/types/assets";

const FIVE_MINUTES_MS = 5 * 60 * 1000;
/**
 * Delay after each window-close before we poll Coinbase for the
 * just-closed 5m bar. Gives the exchange time to settle the candle
 * and the REST endpoint to serve it. ~3s is well under the live
 * runner's `WINDOW_SUMMARY_DELAY_MS` (8s) so the bar lands before
 * `wrapUpWindow` fires.
 */
const BAR_POLL_DELAY_MS = 3_000;

/**
 * Trader-side adapter around the Coinbase Advanced Trade spot quote
 * stream + a synthetic bar-close emitter.
 *
 * The Coinbase stream only emits per-tick BBO updates; unlike Binance's
 * `kline_5m` stream there's no native closed-bar event. Since the
 * regime trackers depend on `onBarClose`, the source spawns a 5-min
 * polling timer that fetches the just-closed bar via
 * `fetchExactFiveMinuteBar` (Coinbase Advanced Trade REST) and
 * dispatches it to the caller. The runner's existing REST-fallback
 * code (`ensureTrackersReadyForWindow`) acts as the safety net if a
 * poll misses.
 *
 * Why coinbase-spot at all: empirical work (2026-05-08) showed
 * binance/perp diverges from Chainlink — the venue Polymarket settles
 * on — about 16% of the time across 70 hours of captured 5m windows,
 * versus 3.3% for coinbase-spot. The bot's regime classifier and line
 * capture should read from the feed that most closely tracks
 * settlement truth. See doc/research/2026-05-08-source-vs-chainlink.md.
 */
export const coinbaseSpotLivePriceSource: LivePriceSource = {
  id: "coinbase-spot",
  stream: ({
    assets,
    onTick,
    onBarClose,
    onConnect,
    onDisconnect,
    onError,
  }: LivePriceFeedParams): LivePriceFeedHandle => {
    const tickHandle = streamCoinbaseSpotQuotes({
      assets,
      onTick: (tick) => {
        onTick({
          asset: tick.asset,
          bid: tick.bid,
          ask: tick.ask,
          mid: tick.mid,
          exchangeTimeMs: tick.tsExchangeMs,
          receivedAtMs: tick.tsReceivedMs,
        });
      },
      onConnect,
      onDisconnect,
      onError: (error) => {
        onError?.(error);
      },
    });

    // Schedule a one-shot timer that fires shortly after each window
    // close, fetches the just-closed bar for every subscribed asset,
    // and dispatches `onBarClose`. Reschedules itself indefinitely.
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
