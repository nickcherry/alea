import { FIVE_MINUTES_MS } from "@alea/lib/livePrices/fiveMinuteWindow";
import type { ReplayEvent } from "@alea/lib/trading/replay/types";
import type { LeadingSide } from "@alea/lib/trading/types";
import type { TradableMarket } from "@alea/lib/trading/vendor/types";
import type { Asset } from "@alea/types/assets";

/**
 * Replay-side projection of a Polymarket up/down 5m market, derived
 * entirely from the captured WS tape (no REST). The fields that the
 * decision evaluator + fill simulator actually consume — `vendorRef`,
 * `upRef`, `downRef`, `windowStartMs`, `asset` — are populated; the
 * REST-only fields (`displayLabel`, `acceptingOrders`, `constraints`)
 * are filled with safe defaults since live trading invariants don't
 * apply to replayed sessions.
 *
 * `polymarketResolved` carries the captured `resolved` event verbatim
 * for cross-checking against the chainlink-derived settlement at
 * window finalize time.
 */
export type ReplayMarket = {
  readonly market: TradableMarket;
  readonly polymarketResolved: ReplayMarketResolution | null;
};

export type ReplayMarketResolution = {
  readonly winningSide: LeadingSide;
  readonly winningOutcomeRef: string;
  readonly resolvedAtMs: number;
};

export type ReplayMarketManifest = {
  /**
   * Per windowStart, per asset: the discovered market. Windows where
   * no market could be derived (missing resolved → unknown up/down,
   * or only one outcomeRef seen) are absent and the per-window driver
   * skips them with a warning.
   */
  readonly byWindow: ReadonlyMap<number, ReadonlyMap<Asset, ReplayMarket>>;
  readonly skipped: readonly ReplayManifestSkip[];
};

export type ReplayManifestSkip = {
  readonly asset: Asset | null;
  readonly vendorRef: string;
  readonly windowStartMs: number;
  readonly reason: string;
};

/**
 * Walks every polymarket WS event in the replay range once, builds a
 * `(windowStartMs, asset) → ReplayMarket` manifest, and returns it
 * alongside a list of markets that couldn't be fully derived (so the
 * caller can log them).
 *
 * Up/down assignment comes from the `resolved` event — `winningSide`
 * + `winningOutcomeRef` pin one tokenId to a side, and the other
 * tokenId observed in the same `vendorRef`'s book/trade events is the
 * opposite side. We don't need (and don't have) the gamma-api
 * outcomes order this way.
 *
 * windowStartMs is `floor(min_event_ts / 5min) * 5min` over only the
 * book/trade/best-bid-ask events for the market. Resolved events fire
 * just AFTER window-end and would skew the floor; pre-discovery
 * events (capture subscribes ~30s ahead) start within the prior
 * window's tail, but for a Polymarket up/down 5m market the WS only
 * starts emitting book/bba once the market is live — so the earliest
 * book/bba/trade is reliably inside [windowStart, windowEnd).
 */
export async function buildReplayMarketManifest({
  events,
}: {
  readonly events: AsyncIterable<ReplayEvent>;
}): Promise<ReplayMarketManifest> {
  type GroupKey = string; // `${asset}|${vendorRef}`
  type Group = {
    readonly asset: Asset;
    readonly vendorRef: string;
    /**
     * Latest TRADE event ts_ms for the market. Polymarket markets
     * close at windowEnd and stop emitting trades shortly before; the
     * floor of the LAST trade lands inside [windowStart, windowEnd)
     * which floors to windowStart cleanly. Using the FIRST trade
     * fails when trades start before windowStart during the
     * pre-discovery subscription period (observed in capture).
     */
    maxTradeTsMs: number | null;
    /**
     * Fallback latest: latest book/bba/trade ts_ms. Used only when
     * no trade events were observed (illiquid markets).
     */
    maxAnyLiveTsMs: number;
    outcomeRefs: Set<string>;
    resolved: ReplayMarketResolution | null;
  };
  const groups = new Map<GroupKey, Group>();
  const resolvedByVendorRef = new Map<string, ReplayMarketResolution>();

  for await (const event of events) {
    if (event.source !== "polymarket") {
      continue;
    }
    if (event.kind === "resolved") {
      const winningSide = event.event.winningSide;
      const winningOutcomeRef = event.event.winningOutcomeRef;
      if (winningSide === null || winningOutcomeRef === null) {
        continue;
      }
      resolvedByVendorRef.set(event.event.vendorRef, {
        winningSide,
        winningOutcomeRef,
        resolvedAtMs: event.event.atMs,
      });
      continue;
    }
    if (
      event.kind !== "book" &&
      event.kind !== "best-bid-ask" &&
      event.kind !== "trade"
    ) {
      continue;
    }
    if (event.asset === null) {
      continue;
    }
    const vendorRef = event.event.vendorRef;
    if (vendorRef === null) {
      continue;
    }
    const key: GroupKey = `${event.asset}|${vendorRef}`;
    let group = groups.get(key);
    if (group === undefined) {
      group = {
        asset: event.asset,
        vendorRef,
        maxTradeTsMs: event.kind === "trade" ? event.event.atMs : null,
        maxAnyLiveTsMs: event.event.atMs,
        outcomeRefs: new Set<string>(),
        resolved: null,
      };
      groups.set(key, group);
    } else {
      if (event.event.atMs > group.maxAnyLiveTsMs) {
        group.maxAnyLiveTsMs = event.event.atMs;
      }
      if (
        event.kind === "trade" &&
        (group.maxTradeTsMs === null || event.event.atMs > group.maxTradeTsMs)
      ) {
        group.maxTradeTsMs = event.event.atMs;
      }
    }
    group.outcomeRefs.add(event.event.outcomeRef);
  }

  // Stitch resolved events into the per-(asset, vendorRef) groups now
  // that we've finished the scan.
  for (const group of groups.values()) {
    const resolved = resolvedByVendorRef.get(group.vendorRef);
    if (resolved !== undefined) {
      group.resolved = resolved;
    }
  }

  const byWindow = new Map<number, Map<Asset, ReplayMarket>>();
  const skipped: ReplayManifestSkip[] = [];

  for (const group of groups.values()) {
    // Prefer the resolved event's atMs (fires inside [windowEnd,
    // windowEnd+~2min) so floor → windowEnd; subtract 5m). Fall back
    // to max(trade), which lands strictly inside [windowStart,
    // windowEnd) for any market we caught alive — floor → windowStart
    // directly. Last resort: max of any live event.
    let windowStartMs: number;
    if (group.resolved !== null) {
      const resolvedAtMs = group.resolved.resolvedAtMs;
      const windowEndMs =
        Math.floor(resolvedAtMs / FIVE_MINUTES_MS) * FIVE_MINUTES_MS;
      windowStartMs = windowEndMs - FIVE_MINUTES_MS;
    } else if (group.maxTradeTsMs !== null) {
      windowStartMs =
        Math.floor(group.maxTradeTsMs / FIVE_MINUTES_MS) * FIVE_MINUTES_MS;
    } else {
      windowStartMs =
        Math.floor(group.maxAnyLiveTsMs / FIVE_MINUTES_MS) * FIVE_MINUTES_MS;
    }
    const tokenIds = [...group.outcomeRefs];
    if (tokenIds.length !== 2) {
      skipped.push({
        asset: group.asset,
        vendorRef: group.vendorRef,
        windowStartMs,
        reason: `expected 2 outcome refs, saw ${tokenIds.length}`,
      });
      continue;
    }
    const resolved = group.resolved;
    if (resolved === null) {
      skipped.push({
        asset: group.asset,
        vendorRef: group.vendorRef,
        windowStartMs,
        reason: "no captured resolved event — cannot derive up/down assignment",
      });
      continue;
    }
    if (!group.outcomeRefs.has(resolved.winningOutcomeRef)) {
      skipped.push({
        asset: group.asset,
        vendorRef: group.vendorRef,
        windowStartMs,
        reason:
          "resolved.winningOutcomeRef not observed in book/trade events for this market",
      });
      continue;
    }
    const winningRef = resolved.winningOutcomeRef;
    const losingRef = tokenIds.find((id) => id !== winningRef);
    if (losingRef === undefined) {
      skipped.push({
        asset: group.asset,
        vendorRef: group.vendorRef,
        windowStartMs,
        reason: "could not determine losing token from outcome set",
      });
      continue;
    }
    const upRef =
      resolved.winningSide === "up" ? winningRef : losingRef;
    const downRef =
      resolved.winningSide === "down" ? winningRef : losingRef;
    const market: TradableMarket = {
      asset: group.asset,
      windowStartUnixSeconds: Math.floor(windowStartMs / 1_000),
      windowStartMs,
      windowEndMs: windowStartMs + FIVE_MINUTES_MS,
      vendorRef: group.vendorRef,
      upRef,
      downRef,
      acceptingOrders: true,
    };
    let perAsset = byWindow.get(windowStartMs);
    if (perAsset === undefined) {
      perAsset = new Map();
      byWindow.set(windowStartMs, perAsset);
    }
    perAsset.set(group.asset, {
      market,
      polymarketResolved: resolved,
    });
  }

  return { byWindow, skipped };
}
