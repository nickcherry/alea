import { pythResolution } from "@alea/lib/candles/sources/pyth/pythResolution";
import { pythSymbol } from "@alea/lib/candles/sources/pyth/pythSymbol";
import { describe, expect, it } from "bun:test";

describe("Pyth candle mappings", () => {
  it("maps alea timeframes to Pyth resolutions", () => {
    expect(pythResolution({ timeframe: "1m" })).toBe("1");
    expect(pythResolution({ timeframe: "5m" })).toBe("5");
    expect(pythResolution({ timeframe: "15m" })).toBe("15");
    expect(pythResolution({ timeframe: "1h" })).toBe("60");
    expect(pythResolution({ timeframe: "4h" })).toBe("240");
    expect(pythResolution({ timeframe: "1d" })).toBe("D");
  });

  it("maps assets to Pyth oracle symbols", () => {
    expect(pythSymbol({ asset: "btc" })).toBe("Crypto.BTC/USD");
    expect(pythSymbol({ asset: "eth" })).toBe("Crypto.ETH/USD");
    expect(pythSymbol({ asset: "sol" })).toBe("Crypto.SOL/USD");
    expect(pythSymbol({ asset: "xrp" })).toBe("Crypto.XRP/USD");
    expect(pythSymbol({ asset: "doge" })).toBe("Crypto.DOGE/USD");
  });
});
