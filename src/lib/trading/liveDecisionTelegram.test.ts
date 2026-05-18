import {
  createLiveDecisionTelegramNotifier,
  formatLiveDecisionTelegramCaption,
} from "@alea/lib/trading/liveDecisionTelegram";
import type { LiveTradingOrderLogEvent } from "@alea/lib/trading/liveOrderExecution";
import { describe, expect, it } from "bun:test";

describe("live decision Telegram notifications", () => {
  it("sends the decision summary only after the live order is placed", async () => {
    const sent: {
      readonly text: string;
    }[] = [];
    const notifier = createLiveDecisionTelegramNotifier({
      log: () => undefined,
      getConfig: () => ({ botToken: "token", chatId: "chat" }),
      sendMessage: async (params) => {
        sent.push({
          text: params.text,
        });
        return { messageId: 123 };
      },
    });

    notifier.trackDecision({
      asset: "btc",
      period: "1h",
      targetTsMs: Date.UTC(2026, 4, 15, 18),
      prediction: "u",
      reasoning: "Clean close above support & no rejection.",
    });

    await notifier.handleOrderEvent(orderEvent({ status: "scheduled" }));
    expect(sent).toHaveLength(0);

    await notifier.handleOrderEvent(orderEvent({ status: "placed" }));

    expect(sent).toEqual([
      {
        text: "BTC 2:00-3:00 PM ET\n\nUP\nClean close above support & no rejection.",
      },
    ]);
  });

  it("drops skipped orders instead of sending stale later notifications", async () => {
    let sent = 0;
    const notifier = createLiveDecisionTelegramNotifier({
      log: () => undefined,
      getConfig: () => ({ botToken: "token", chatId: "chat" }),
      sendMessage: async () => {
        sent += 1;
        return { messageId: 123 };
      },
    });

    notifier.trackDecision({
      asset: "btc",
      period: "1h",
      targetTsMs: Date.UTC(2026, 4, 15, 18),
      prediction: "d",
      reasoning: "Rejected above range.",
    });

    await notifier.handleOrderEvent(
      orderEvent({ status: "skipped_no_market" }),
    );
    await notifier.handleOrderEvent(orderEvent({ status: "placed" }));

    expect(sent).toBe(0);
  });

  it("logs a missing Telegram config after placement without throwing", async () => {
    const errors: string[] = [];
    const notifier = createLiveDecisionTelegramNotifier({
      log: (event) => errors.push(event.message),
      getConfig: () => null,
    });

    notifier.trackDecision({
      asset: "btc",
      period: "1h",
      targetTsMs: Date.UTC(2026, 4, 15, 18),
      prediction: "u",
      reasoning: "Continuation.",
    });

    await notifier.handleOrderEvent(orderEvent({ status: "placed" }));

    expect(errors).toEqual([
      "live decision Telegram skipped: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is missing",
    ]);
  });

  it("formats a compact message", () => {
    expect(
      formatLiveDecisionTelegramCaption({
        asset: "eth",
        period: "1h",
        targetTsMs: Date.UTC(2026, 4, 15, 18),
        prediction: "d",
        reasoning: "High sweep < prior range.",
      }),
    ).toBe("ETH 2:00-3:00 PM ET\n\nDOWN\nHigh sweep < prior range.");
  });
});

function orderEvent(
  overrides: Partial<LiveTradingOrderLogEvent>,
): LiveTradingOrderLogEvent {
  return {
    kind: "live-order",
    asset: "btc",
    period: "1h",
    tsMs: Date.UTC(2026, 4, 15, 18),
    prediction: "u",
    status: "placed",
    attempt: 1,
    observedPrice: null,
    limitPrice: null,
    confidence: null,
    orderId: null,
    marketRef: null,
    tokenRef: null,
    oppositeTokenRef: null,
    failureStatus: null,
    failureKind: null,
    postDurationMs: null,
    predictedBestBid: null,
    predictedBestAsk: null,
    predictedSpread: null,
    predictedBidAgeMs: null,
    predictedAskAgeMs: null,
    predictedBookAgeMs: null,
    predictedBidLevels: null,
    predictedAskLevels: null,
    predictedBidDepthAtLimitUsd: null,
    predictedBidDepthAboveLimitUsd: null,
    predictedBidDepthAtOrAboveLimitUsd: null,
    predictedAskDepthAtBestUsd: null,
    predictedAskDepthWithin1cUsd: null,
    predictedAskDepthWithin2cUsd: null,
    oppositeBestBid: null,
    oppositeBestAsk: null,
    oppositeSpread: null,
    message: null,
    ...overrides,
  };
}
