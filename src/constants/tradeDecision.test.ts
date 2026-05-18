import {
  formatTradeDecisionMarkets,
  nextTradeDecisionFireTimeMs,
  resolveTradeDecisionMarkets,
  TRADE_DECISION_DEFAULT_MARKETS,
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

  it("hydrates 288 bars per period by default", () => {
    expect(tradeDecisionHydrateBars({ period: "1h" })).toBe(288);
  });

  it("fires the decision at the target candle's open (no lead time)", () => {
    // At now=12:24:59 inside the 12:00-13:00 hour, the candle we'd enter
    // is the 13:00-14:00 candle. We make the decision AT 13:00 and enter
    // at the 13:00 open.
    const nowMs = Date.UTC(2026, 4, 17, 12, 24, 59);
    const targetTsMs = Date.UTC(2026, 4, 17, 13, 0, 0);

    expect(tradeDecisionTargetOpenTimeMs({ period: "1h", nowMs })).toBe(
      targetTsMs,
    );
    expect(tradeDecisionFireTimeMs({ period: "1h", targetTsMs })).toBe(
      targetTsMs,
    );
    expect(nextTradeDecisionFireTimeMs({ period: "1h", nowMs })).toBe(
      targetTsMs,
    );
    // Once we are past the 13:00 target fire, next fire is the 14:00 open.
    expect(
      nextTradeDecisionFireTimeMs({
        period: "1h",
        nowMs: Date.UTC(2026, 4, 17, 13, 0, 1),
      }),
    ).toBe(Date.UTC(2026, 4, 17, 14, 0, 0));
  });
});
