import { FIVE_MINUTES_MS } from "@alea/lib/livePrices/fiveMinuteWindow";
import type { ReplayMarketResolution } from "@alea/lib/trading/replay/derivedMarkets";
import type { ReplayChainlinkRefPriceEvent } from "@alea/lib/trading/replay/types";
import type { LeadingSide } from "@alea/lib/trading/types";
import type { Asset } from "@alea/types/assets";

/**
 * Per-asset resolution of a single 5-minute window. The chainlink
 * source is treated as ground truth (it's the actual settlement feed
 * Polymarket uses); the captured polymarket `resolved` event is
 * carried alongside as a cross-check, with `disagreementWithPolymarket`
 * flagged when the two reach different sides. Mismatch tracking is the
 * primary research output here — it lets us spot proxy-divergence
 * cases where the captured chainlink data we have doesn't reproduce
 * Polymarket's actual settlement.
 *
 * `chainlinkLine` and `chainlinkClose` use the most-recent chainlink
 * reference-price event with `tsMs <= windowStart` and `tsMs <=
 * windowEnd` respectively. If no event satisfies the boundary
 * (typical for windows near the start of a capture), we fall back to
 * the first event in the window — accepting that the line is then
 * mid-window-anchored. The `flags` field records when fallback
 * happened so downstream stats can filter those windows out.
 */
export type ChainlinkOutcome = {
  readonly chainlinkLine: number;
  readonly chainlinkLineTsMs: number;
  readonly chainlinkClose: number;
  readonly chainlinkCloseTsMs: number;
  readonly winningSide: LeadingSide;
  readonly polymarketResolution: ReplayMarketResolution | null;
  readonly disagreementWithPolymarket: boolean | null;
  readonly flags: ChainlinkOutcomeFlag[];
};

export type ChainlinkOutcomeFlag =
  | "line-after-window-start"
  | "close-after-window-end";

export type ChainlinkResolutionError =
  | { readonly kind: "no-events"; readonly reason: string }
  | { readonly kind: "no-line"; readonly reason: string }
  | { readonly kind: "no-close"; readonly reason: string };

export type ResolveWindowOutcomeResult =
  | { readonly status: "resolved"; readonly outcome: ChainlinkOutcome }
  | { readonly status: "error"; readonly error: ChainlinkResolutionError };

/**
 * Maximum delta past `windowStartMs` a chainlink event may have to be
 * accepted as "line" when no prior event exists. Generous so the very
 * first window of a fresh capture still resolves; the `flags` field
 * tells the caller it was fallback.
 */
const FALLBACK_LINE_TOLERANCE_MS = FIVE_MINUTES_MS;

/**
 * Maximum delta past `windowEndMs` a chainlink event may have to be
 * accepted as "close" when no event landed inside the window. Same
 * generosity; same flag.
 */
const FALLBACK_CLOSE_TOLERANCE_MS = FIVE_MINUTES_MS;

export function resolveWindowOutcome({
  windowStartMs,
  chainlinkEvents,
  polymarketResolution,
}: {
  readonly windowStartMs: number;
  readonly chainlinkEvents: readonly ReplayChainlinkRefPriceEvent[];
  readonly polymarketResolution: ReplayMarketResolution | null;
}): ResolveWindowOutcomeResult {
  const windowEndMs = windowStartMs + FIVE_MINUTES_MS;
  if (chainlinkEvents.length === 0) {
    return {
      status: "error",
      error: {
        kind: "no-events",
        reason: "no captured chainlink reference-price events for this asset",
      },
    };
  }
  const sorted = [...chainlinkEvents].sort((a, b) => a.tsMs - b.tsMs);
  const flags: ChainlinkOutcomeFlag[] = [];

  const linePick = pickAtOrBefore({
    events: sorted,
    targetMs: windowStartMs,
    fallbackTolerance: FALLBACK_LINE_TOLERANCE_MS,
  });
  if (linePick === null) {
    return {
      status: "error",
      error: {
        kind: "no-line",
        reason: `no chainlink event within ${FALLBACK_LINE_TOLERANCE_MS}ms of windowStart=${new Date(windowStartMs).toISOString()}`,
      },
    };
  }
  if (linePick.fromFallback) {
    flags.push("line-after-window-start");
  }

  const closePick = pickAtOrBefore({
    events: sorted,
    targetMs: windowEndMs,
    fallbackTolerance: FALLBACK_CLOSE_TOLERANCE_MS,
  });
  if (closePick === null) {
    return {
      status: "error",
      error: {
        kind: "no-close",
        reason: `no chainlink event within ${FALLBACK_CLOSE_TOLERANCE_MS}ms of windowEnd=${new Date(windowEndMs).toISOString()}`,
      },
    };
  }
  if (closePick.fromFallback) {
    flags.push("close-after-window-end");
  }

  const winningSide: LeadingSide =
    closePick.event.value >= linePick.event.value ? "up" : "down";

  const disagreementWithPolymarket =
    polymarketResolution === null
      ? null
      : polymarketResolution.winningSide !== winningSide;

  return {
    status: "resolved",
    outcome: {
      chainlinkLine: linePick.event.value,
      chainlinkLineTsMs: linePick.event.tsMs,
      chainlinkClose: closePick.event.value,
      chainlinkCloseTsMs: closePick.event.tsMs,
      winningSide,
      polymarketResolution,
      disagreementWithPolymarket,
      flags,
    },
  };
}

function pickAtOrBefore({
  events,
  targetMs,
  fallbackTolerance,
}: {
  readonly events: readonly ReplayChainlinkRefPriceEvent[];
  readonly targetMs: number;
  readonly fallbackTolerance: number;
}): {
  readonly event: ReplayChainlinkRefPriceEvent;
  readonly fromFallback: boolean;
} | null {
  // Last event whose tsMs <= targetMs, scanned backwards so we hit
  // the most recent first.
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event !== undefined && event.tsMs <= targetMs) {
      return { event, fromFallback: false };
    }
  }
  // Fall back to the earliest event after targetMs, if it's within
  // tolerance. Used for the very first window of a capture where
  // chainlink hadn't yet ticked when the window opened.
  const first = events[0];
  if (first === undefined) {
    return null;
  }
  if (first.tsMs - targetMs > fallbackTolerance) {
    return null;
  }
  return { event: first, fromFallback: true };
}

/**
 * Buckets all chainlink reference-price events from a tape into per-
 * asset arrays so the per-asset resolution call doesn't re-scan the
 * full event list.
 */
export function bucketChainlinkByAsset({
  events,
}: {
  readonly events: readonly ReplayChainlinkRefPriceEvent[];
}): ReadonlyMap<Asset, readonly ReplayChainlinkRefPriceEvent[]> {
  const out = new Map<Asset, ReplayChainlinkRefPriceEvent[]>();
  for (const event of events) {
    let bucket = out.get(event.asset);
    if (bucket === undefined) {
      bucket = [];
      out.set(event.asset, bucket);
    }
    bucket.push(event);
  }
  return out;
}
