import {
  createLiveDecisionTelegramNotifier,
  formatLiveDecisionTelegramCaption,
} from "@alea/lib/trading/liveDecisionTelegram";
import type { LiveTradingOrderLogEvent } from "@alea/lib/trading/liveOrderExecution";
import { describe, expect, it } from "bun:test";

describe("live decision Telegram notifications", () => {
  it("sends the chart only after the live order is placed", async () => {
    const sent: {
      readonly photoPath: string;
      readonly caption: string | undefined;
      readonly format: string | undefined;
    }[] = [];
    const notifier = createLiveDecisionTelegramNotifier({
      log: () => undefined,
      getConfig: () => ({ botToken: "token", chatId: "chat" }),
      sendPhoto: async (params) => {
        sent.push({
          photoPath: params.photoPath,
          caption: params.caption,
          format: params.format,
        });
        return { messageId: 123 };
      },
    });

    notifier.trackDecision({
      asset: "btc",
      period: "5m",
      targetTsMs: Date.UTC(2026, 4, 15, 18, 15),
      prediction: "u",
      imagePath: "/tmp/btc-5m.png",
      reasoning: "Clean close above support & no rejection.",
    });

    await notifier.handleOrderEvent(orderEvent({ status: "scheduled" }));
    expect(sent).toHaveLength(0);

    await notifier.handleOrderEvent(orderEvent({ status: "placed" }));

    expect(sent).toEqual([
      {
        photoPath: "/tmp/btc-5m.png",
        format: "html",
        caption:
          "<b>BTC 2:15-2:20 PM ET</b>\n\n<b>UP</b>\nClean close above support &amp; no rejection.",
      },
    ]);
  });

  it("drops skipped orders instead of sending stale later notifications", async () => {
    let sent = 0;
    const notifier = createLiveDecisionTelegramNotifier({
      log: () => undefined,
      getConfig: () => ({ botToken: "token", chatId: "chat" }),
      sendPhoto: async () => {
        sent += 1;
        return { messageId: 123 };
      },
    });

    notifier.trackDecision({
      asset: "btc",
      period: "5m",
      targetTsMs: Date.UTC(2026, 4, 15, 18, 15),
      prediction: "d",
      imagePath: "/tmp/btc-5m.png",
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
      period: "5m",
      targetTsMs: Date.UTC(2026, 4, 15, 18, 15),
      prediction: "u",
      imagePath: "/tmp/btc-5m.png",
      reasoning: "Continuation.",
    });

    await notifier.handleOrderEvent(orderEvent({ status: "placed" }));

    expect(errors).toEqual([
      "live decision Telegram skipped: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is missing",
    ]);
  });

  it("formats a compact escaped caption", () => {
    expect(
      formatLiveDecisionTelegramCaption({
        asset: "eth",
        period: "15m",
        targetTsMs: Date.UTC(2026, 4, 15, 18, 15),
        prediction: "d",
        imagePath: "/tmp/eth-15m.png",
        reasoning: "High sweep < prior range.",
      }),
    ).toBe(
      "<b>ETH 2:15-2:30 PM ET</b>\n\n<b>DOWN</b>\nHigh sweep &lt; prior range.",
    );
  });
});

function orderEvent(
  overrides: Partial<LiveTradingOrderLogEvent>,
): LiveTradingOrderLogEvent {
  return {
    kind: "live-order",
    asset: "btc",
    period: "5m",
    tsMs: Date.UTC(2026, 4, 15, 18, 15),
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
