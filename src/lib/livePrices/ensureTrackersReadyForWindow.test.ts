import {
  createTrackerHydrationState,
  ensureTrackersReadyForWindow,
} from "@alea/lib/livePrices/ensureTrackersReadyForWindow";
import { FIVE_MINUTES_MS } from "@alea/lib/livePrices/fiveMinuteWindow";
import { createRegimeTrackers } from "@alea/lib/livePrices/regimeTrackers";
import type { LivePriceSource } from "@alea/lib/livePrices/source";
import type { ClosedFiveMinuteBar } from "@alea/lib/livePrices/types";
import type { Asset } from "@alea/types/assets";
import { describe, expect, it } from "bun:test";

describe("ensureTrackersReadyForWindow", () => {
  it("hydrates the prior closed 5m bar from REST when trackers missed the ws close", async () => {
    const windowStartMs = Date.parse("2026-05-04T12:35:00.000Z");
    const priorOpenMs = windowStartMs - FIVE_MINUTES_MS;
    const bar = closedBar({ openTimeMs: priorOpenMs, close: 101 });
    const fetched: number[] = [];
    const logs: string[] = [];
    const lastClosedBars = new Map<Asset, ClosedFiveMinuteBar>();
    const bundle = createRegimeTrackers();
    const trackers = new Map([["btc" as const, bundle]]);

    ensureTrackersReadyForWindow({
      assets: ["btc"],
      windowStartMs,
      nowMs: windowStartMs + 60_000,
      priceSource: fakePriceSource({
        onFetch: ({ openTimeMs }) => {
          fetched.push(openTimeMs);
          return bar;
        },
      }),
      trackers,
      lastClosedBars,
      state: createTrackerHydrationState(),
      signal: new AbortController().signal,
      emit: (event) => logs.push(event.message),
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetched).toEqual([priorOpenMs]);
    expect(bundle.lastBarOpenMs()).toBe(priorOpenMs);
    expect(lastClosedBars.get("btc")).toEqual(bar);
    expect(logs[0]).toContain("BTC   REST hydrated 5m close 12:30 UTC");
  });

  it("throttles missing REST bars instead of refetching every tick", async () => {
    const windowStartMs = Date.parse("2026-05-04T12:35:00.000Z");
    let fetchCount = 0;
    const state = createTrackerHydrationState();
    const source = fakePriceSource({
      onFetch: () => {
        fetchCount += 1;
        return null;
      },
    });
    const params = {
      assets: ["btc"] as readonly Asset[],
      windowStartMs,
      priceSource: source,
      trackers: new Map([["btc" as const, createRegimeTrackers()]]),
      state,
      signal: new AbortController().signal,
      emit: () => undefined,
    };

    ensureTrackersReadyForWindow({
      ...params,
      nowMs: windowStartMs + 60_000,
    });
    ensureTrackersReadyForWindow({
      ...params,
      nowMs: windowStartMs + 61_000,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchCount).toBe(1);
  });
});

function fakePriceSource({
  onFetch,
}: {
  readonly onFetch: (params: {
    readonly openTimeMs: number;
  }) => ClosedFiveMinuteBar | null;
}): LivePriceSource {
  return {
    id: "fake",
    stream: () => ({ stop: async () => undefined }),
    fetchRecentFiveMinuteBars: async () => [],
    fetchExactFiveMinuteBar: async ({ openTimeMs }) => onFetch({ openTimeMs }),
  };
}

function closedBar({
  openTimeMs,
  close,
}: {
  readonly openTimeMs: number;
  readonly close: number;
}): ClosedFiveMinuteBar {
  return {
    asset: "btc",
    openTimeMs,
    closeTimeMs: openTimeMs + FIVE_MINUTES_MS,
    open: close - 1,
    high: close + 1,
    low: close - 2,
    close,
  };
}
