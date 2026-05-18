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
      { asset: "doge", period: "1h" },
    ]);
    expect(
      formatTradeDecisionMarkets({ markets: TRADE_DECISION_DEFAULT_MARKETS }),
    ).toBe("1h/btc,1h/eth,1h/sol,1h/doge");
  });

  it("expands explicit asset or period overrides as a grid", () => {
    expect(resolveTradeDecisionMarkets({ assets: ["eth"] })).toEqual([
      { asset: "eth", period: "1h" },
    ]);
    expect(resolveTradeDecisionMarkets({ periods: ["1h"] })).toEqual([
      { asset: "btc", period: "1h" },
      { asset: "eth", period: "1h" },
      { asset: "sol", period: "1h" },
      { asset: "doge", period: "1h" },
    ]);
  });

  it("uses chart-window-sized hydration by period", () => {
    expect(tradeDecisionHydrateBars({ period: "1h" })).toBe(288);
    expect(TRADE_DECISION_HYDRATE_BARS).toBe(288);
  });

  it("targets the current hourly market ten minutes before close", () => {
    const nowMs = Date.UTC(2026, 4, 17, 12, 49, 59);
    const targetTsMs = Date.UTC(2026, 4, 17, 12, 0, 0);

    expect(tradeDecisionTargetOpenTimeMs({ period: "1h", nowMs })).toBe(
      targetTsMs,
    );
    expect(tradeDecisionFireTimeMs({ period: "1h", targetTsMs })).toBe(
      Date.UTC(2026, 4, 17, 12, 50, 0),
    );
    expect(nextTradeDecisionFireTimeMs({ period: "1h", nowMs })).toBe(
      Date.UTC(2026, 4, 17, 12, 50, 0),
    );
    expect(
      nextTradeDecisionFireTimeMs({
        period: "1h",
        nowMs: Date.UTC(2026, 4, 17, 12, 50, 0),
      }),
    ).toBe(Date.UTC(2026, 4, 17, 13, 50, 0));
  });
});
