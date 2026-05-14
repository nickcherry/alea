import type { LiveTradingLogEvent } from "@alea/lib/trading/runLiveTrading";

export function liveTradingLogEventToTelemetry(
  event: LiveTradingLogEvent,
): Record<string, unknown> {
  switch (event.kind) {
    case "hydrated":
      return {
        event: "hydrate",
        mode: "live",
        asset: event.asset,
        period: event.period,
        barCount: event.barCount,
      };
    case "ready":
      return { event: "runner_ready", mode: "live" };
    case "roster":
      return {
        event: "roster_loaded",
        mode: "live",
        bucketCount: event.bucketCount,
        totalCandidates: event.totalCandidates,
        selectedAtMs: event.selectedAtMs,
        selectedAt:
          event.selectedAtMs === null
            ? null
            : new Date(event.selectedAtMs).toISOString(),
      };
    case "decision":
      return {
        event: "decision",
        mode: "live",
        decisionId: decisionId(event),
        asset: event.asset,
        period: event.period,
        targetTsMs: event.tsMs,
        targetAt: new Date(event.tsMs).toISOString(),
        prediction: event.prediction,
        synthClose: event.synthClose,
        priceAgeMs: event.priceAgeMs,
        marketRegime: event.marketRegime,
        rosterSize: event.rosterSize,
        upVotes: event.up,
        downVotes: event.down,
        abstainVotes: event.abstain,
        confidence: event.confidence,
      };
    case "live-market":
      return {
        event: "market_stream",
        mode: "live",
        streamStatus: event.status,
        marketCount: event.status === "subscribed" ? event.marketCount : null,
        message: event.status === "subscribed" ? null : event.message,
      };
    case "live-order":
      return {
        event:
          event.status === "scheduled"
            ? "order_scheduled"
            : event.status === "attempting"
              ? "order_attempt"
              : "order_result",
        mode: "live",
        decisionId: decisionId(event),
        asset: event.asset,
        period: event.period,
        targetTsMs: event.tsMs,
        targetAt: new Date(event.tsMs).toISOString(),
        prediction: event.prediction,
        orderStatus: event.status,
        attempt: event.attempt,
        observedPrice: event.observedPrice,
        limitPrice: event.limitPrice,
        limitPriceCents:
          event.limitPrice === null
            ? null
            : Number((event.limitPrice * 100).toFixed(4)),
        confidence: event.confidence,
        orderId: event.orderId,
        marketRef: event.marketRef,
        tokenRef: event.tokenRef,
        oppositeTokenRef: event.oppositeTokenRef,
        failureStatus: event.failureStatus,
        failureKind: event.failureKind,
        postDurationMs: event.postDurationMs,
        predictedBestBid: event.predictedBestBid,
        predictedBestAsk: event.predictedBestAsk,
        predictedSpread: event.predictedSpread,
        predictedSpreadCents:
          event.predictedSpread === null
            ? null
            : Number((event.predictedSpread * 100).toFixed(4)),
        predictedBidAgeMs: event.predictedBidAgeMs,
        predictedAskAgeMs: event.predictedAskAgeMs,
        predictedBookAgeMs: event.predictedBookAgeMs,
        predictedBidLevels: event.predictedBidLevels,
        predictedAskLevels: event.predictedAskLevels,
        predictedBidDepthAtLimitUsd: event.predictedBidDepthAtLimitUsd,
        predictedBidDepthAboveLimitUsd: event.predictedBidDepthAboveLimitUsd,
        predictedBidDepthAtOrAboveLimitUsd:
          event.predictedBidDepthAtOrAboveLimitUsd,
        predictedAskDepthAtBestUsd: event.predictedAskDepthAtBestUsd,
        predictedAskDepthWithin1cUsd: event.predictedAskDepthWithin1cUsd,
        predictedAskDepthWithin2cUsd: event.predictedAskDepthWithin2cUsd,
        oppositeBestBid: event.oppositeBestBid,
        oppositeBestAsk: event.oppositeBestAsk,
        oppositeSpread: event.oppositeSpread,
        message: event.message,
      };
    case "error":
      return {
        event: "runtime_error",
        mode: "live",
        message: event.message,
      };
  }
}

function decisionId({
  asset,
  period,
  tsMs,
}: {
  readonly asset: string;
  readonly period: string;
  readonly tsMs: number;
}): string {
  return `${asset}:${period}:${tsMs}`;
}
