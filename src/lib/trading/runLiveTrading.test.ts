import {
  isLiveDecisionTooLateForOrder,
  type LiveTradingLogEvent,
  waitForDueLiveDecisions,
} from "@alea/lib/trading/runLiveTrading";
import { describe, expect, it } from "bun:test";

describe("waitForDueLiveDecisions", () => {
  it("returns after logging a hung decision timeout", async () => {
    const events: LiveTradingLogEvent[] = [];
    const startedAt = Date.now();

    await waitForDueLiveDecisions({
      timeoutMs: 5,
      decisions: [
        {
          asset: "doge",
          period: "5m",
          targetTsMs: Date.UTC(2026, 4, 15, 22, 30),
          promise: new Promise(() => {
            /* intentionally left pending */
          }),
        },
      ],
      log: (event) => events.push(event),
    });

    expect(Date.now() - startedAt).toBeLessThan(100);
    expect(events).toEqual([
      {
        kind: "error",
        message:
          "decision timed out 5m/doge target=2026-05-15T22:30:00.000Z after 5ms; scheduler continuing",
      },
    ]);
  });

  it("does not log when decisions finish before the watchdog", async () => {
    const events: LiveTradingLogEvent[] = [];

    await waitForDueLiveDecisions({
      timeoutMs: 100,
      decisions: [
        {
          asset: "btc",
          period: "15m",
          targetTsMs: Date.UTC(2026, 4, 15, 22, 30),
          promise: Promise.resolve(),
        },
      ],
      log: (event) => events.push(event),
    });

    expect(events).toEqual([]);
  });
});

describe("isLiveDecisionTooLateForOrder", () => {
  it("allows decisions inside the post-open retry window", () => {
    const targetTsMs = Date.UTC(2026, 4, 15, 22, 30);

    expect(
      isLiveDecisionTooLateForOrder({
        targetTsMs,
        nowMs: targetTsMs + 10_000,
      }),
    ).toBe(false);
  });

  it("blocks decisions after the post-open retry window", () => {
    const targetTsMs = Date.UTC(2026, 4, 15, 22, 30);

    expect(
      isLiveDecisionTooLateForOrder({
        targetTsMs,
        nowMs: targetTsMs + 10_001,
      }),
    ).toBe(true);
  });
});
