import {
  formatTradeDecisionMarkets,
  resolveTradeDecisionMarkets,
  TRADE_DECISION_DEFAULT_MARKETS,
} from "@alea/constants/tradeDecision";
import { describe, expect, it } from "bun:test";

describe("trade decision market defaults", () => {
  it("uses the selected no-override default market set exactly", () => {
    expect(resolveTradeDecisionMarkets({})).toEqual([
      { asset: "btc", period: "5m" },
      { asset: "btc", period: "15m" },
      { asset: "eth", period: "5m" },
      { asset: "eth", period: "15m" },
      { asset: "sol", period: "5m" },
      { asset: "sol", period: "15m" },
      { asset: "xrp", period: "5m" },
      { asset: "xrp", period: "15m" },
      { asset: "doge", period: "5m" },
      { asset: "doge", period: "15m" },
    ]);
    expect(
      formatTradeDecisionMarkets({ markets: TRADE_DECISION_DEFAULT_MARKETS }),
    ).toBe(
      "5m/btc,15m/btc,5m/eth,15m/eth,5m/sol,15m/sol,5m/xrp,15m/xrp,5m/doge,15m/doge",
    );
  });

  it("expands explicit asset or period overrides as a grid", () => {
    expect(resolveTradeDecisionMarkets({ assets: ["eth"] })).toEqual([
      { asset: "eth", period: "5m" },
      { asset: "eth", period: "15m" },
    ]);
    expect(resolveTradeDecisionMarkets({ periods: ["15m"] })).toEqual([
      { asset: "btc", period: "15m" },
      { asset: "eth", period: "15m" },
      { asset: "sol", period: "15m" },
      { asset: "xrp", period: "15m" },
      { asset: "doge", period: "15m" },
    ]);
  });
});
