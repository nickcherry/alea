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
          period: "1h",
          targetTsMs: Date.UTC(2026, 4, 15, 22),
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
          "decision timed out 1h/doge target=2026-05-15T22:00:00.000Z after 5ms; scheduler continuing",
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
          period: "1h",
          targetTsMs: Date.UTC(2026, 4, 15, 22),
          promise: Promise.resolve(),
        },
      ],
      log: (event) => events.push(event),
    });

    expect(events).toEqual([]);
  });
});

describe("isLiveDecisionTooLateForOrder", () => {
  it("allows decisions before the target 1h market closes", () => {
    const targetTsMs = Date.UTC(2026, 4, 15, 22);

    expect(
      isLiveDecisionTooLateForOrder({
        period: "1h",
        targetTsMs,
        nowMs: targetTsMs + 59 * 60_000,
      }),
    ).toBe(false);
  });

  it("blocks decisions once the target 1h market has closed", () => {
    const targetTsMs = Date.UTC(2026, 4, 15, 22);

    expect(
      isLiveDecisionTooLateForOrder({
        period: "1h",
        targetTsMs,
        nowMs: targetTsMs + 60 * 60_000,
      }),
    ).toBe(true);
  });
});
