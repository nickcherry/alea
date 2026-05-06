import { FIVE_MINUTES_MS } from "@alea/lib/livePrices/fiveMinuteWindow";
import {
  describeRegimeTrackers,
  type RegimeTrackers,
} from "@alea/lib/livePrices/regimeTrackers";
import type { LivePriceSource } from "@alea/lib/livePrices/source";
import type { ClosedFiveMinuteBar } from "@alea/lib/livePrices/types";
import type { Asset } from "@alea/types/assets";

const REST_TRACKER_RETRY_MS = 5_000;

export type TrackerHydrationState = {
  readonly inFlight: Set<string>;
  readonly nextAttemptAtMs: Map<string, number>;
};

type TrackerHydrationEvent = {
  readonly kind: "info" | "warn";
  readonly atMs: number;
  readonly message: string;
};

export function createTrackerHydrationState(): TrackerHydrationState {
  return {
    inFlight: new Set(),
    nextAttemptAtMs: new Map(),
  };
}

/**
 * Keeps live regime trackers usable even when the price websocket misses
 * a 5-minute kline-close frame. Book ticks can keep flowing while kline
 * closes are absent; without this REST fallback the decision path stays
 * silently gated because the trackers are not evaluated through the prior
 * closed bar.
 */
export function ensureTrackersReadyForWindow({
  assets,
  windowStartMs,
  nowMs,
  priceSource,
  trackers,
  lastClosedBars,
  state,
  signal,
  emit,
}: {
  readonly assets: readonly Asset[];
  readonly windowStartMs: number;
  readonly nowMs: number;
  readonly priceSource: LivePriceSource;
  readonly trackers: ReadonlyMap<Asset, RegimeTrackers>;
  readonly lastClosedBars?: Map<Asset, ClosedFiveMinuteBar>;
  readonly state: TrackerHydrationState;
  readonly signal: AbortSignal;
  readonly emit: (event: TrackerHydrationEvent) => void;
}): void {
  const targetOpenTimeMs = windowStartMs - FIVE_MINUTES_MS;
  for (const asset of assets) {
    const bundle = trackers.get(asset);
    if (bundle === undefined) {
      continue;
    }
    if (bundle.lastBarOpenMs() === targetOpenTimeMs) {
      continue;
    }
    const key = `${asset}:${targetOpenTimeMs}`;
    if (state.inFlight.has(key)) {
      continue;
    }
    const nextAttemptAtMs = state.nextAttemptAtMs.get(key);
    if (nextAttemptAtMs !== undefined && nowMs < nextAttemptAtMs) {
      continue;
    }
    state.inFlight.add(key);
    state.nextAttemptAtMs.set(key, nowMs + REST_TRACKER_RETRY_MS);
    void priceSource
      .fetchExactFiveMinuteBar({
        asset,
        openTimeMs: targetOpenTimeMs,
        signal,
      })
      .then((bar) => {
        if (bar === null || signal.aborted) {
          return;
        }
        lastClosedBars?.set(asset, bar);
        const accepted = bundle.append(bar);
        if (accepted) {
          state.nextAttemptAtMs.delete(key);
          emit({
            kind: "info",
            atMs: Date.now(),
            message: `${asset.toUpperCase().padEnd(5)} REST hydrated 5m close ${new Date(bar.openTimeMs).toISOString().slice(11, 16)} UTC: close=${bar.close}, ${describeRegimeTrackers({ trackers: bundle })}`,
          });
        }
      })
      .catch((error) => {
        if (signal.aborted) {
          return;
        }
        emit({
          kind: "warn",
          atMs: Date.now(),
          message: `${asset.toUpperCase().padEnd(5)} REST 5m close hydration failed: ${(error as Error).message}`,
        });
      })
      .finally(() => {
        state.inFlight.delete(key);
      });
  }
}
