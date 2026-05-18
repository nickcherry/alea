import {
  formatTradeDecisionMarkets,
  nextTradeDecisionFireTimeMs,
  resolveTradeDecisionMarkets,
  TRADE_DECISION_DEFAULT_MARKETS,
  TRADE_DECISION_HYDRATE_BARS,
  tradeDecisionFireTimeMs,
  tradeDecisionHydrateBars,
  tradeDecisionTargetOpenTimeMs,
} from "@alea/constants/tradeDecision";
import { describe, expect, it } from "bun:test";

describe("trade decision market defaults", () => {
  it("uses the selected no-override default market set exactly", () => {
    expect(resolveTradeDecisionMarkets({})).toEqual([
      { asset: "btc", period: "1h" },
      { asset: "eth", period: "1h" },
      { asset: "sol", period: "1h" },
      { asset: "xrp", period: "1h" },
      { asset: "doge", period: "1h" },
    ]);
    expect(
      formatTradeDecisionMarkets({ markets: TRADE_DECISION_DEFAULT_MARKETS }),
    ).toBe("1h/btc,1h/eth,1h/sol,1h/xrp,1h/doge");
  });

  it("expands explicit asset or period overrides as a grid", () => {
    expect(resolveTradeDecisionMarkets({ assets: ["eth"] })).toEqual([
      { asset: "eth", period: "1h" },
    ]);
    expect(resolveTradeDecisionMarkets({ periods: ["1h"] })).toEqual([
      { asset: "btc", period: "1h" },
      { asset: "eth", period: "1h" },
      { asset: "sol", period: "1h" },
      { asset: "xrp", period: "1h" },
      { asset: "doge", period: "1h" },
    ]);
  });

  it("uses chart-window-sized hydration by period", () => {
    expect(tradeDecisionHydrateBars({ period: "1h" })).toBe(288);
    expect(TRADE_DECISION_HYDRATE_BARS).toBe(288);
  });

  it("targets the next (not-yet-open) hourly market 35 minutes before its open", () => {
    // See doc/DECISION_TIMING.md. At now=12:24:59 inside the 12:00-13:00 hour,
    // the candle we are *predicting* is the 13:00-14:00 candle, and the
    // decision fires 35 minutes before that opens — i.e. at 12:25:00.
    const nowMs = Date.UTC(2026, 4, 17, 12, 24, 59);
    const targetTsMs = Date.UTC(2026, 4, 17, 13, 0, 0);
    const fireTsMs = Date.UTC(2026, 4, 17, 12, 25, 0);

    expect(tradeDecisionTargetOpenTimeMs({ period: "1h", nowMs })).toBe(
      targetTsMs,
    );
    expect(tradeDecisionFireTimeMs({ period: "1h", targetTsMs })).toBe(
      fireTsMs,
    );
    expect(nextTradeDecisionFireTimeMs({ period: "1h", nowMs })).toBe(fireTsMs);
    // Once we are past the fire window for the 13:00 target, the next
    // upcoming fire is for the 14:00 target at 13:25.
    expect(
      nextTradeDecisionFireTimeMs({
        period: "1h",
        nowMs: Date.UTC(2026, 4, 17, 12, 26, 0),
      }),
    ).toBe(Date.UTC(2026, 4, 17, 13, 25, 0));
  });
});
