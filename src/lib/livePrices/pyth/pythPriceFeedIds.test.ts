import {
  assetForPythPriceFeedId,
  pythPriceFeedIds,
} from "@alea/lib/livePrices/pyth/pythPriceFeedIds";
import { describe, expect, it } from "bun:test";

describe("pythPriceFeedIds", () => {
  it("has a 64-char hex id (after the 0x prefix) for every whitelisted asset", () => {
    for (const [asset, id] of Object.entries(pythPriceFeedIds)) {
      expect(id, `${asset} feed id`).toMatch(/^0x[0-9a-f]{64}$/);
    }
  });

  it("round-trips id ↔ asset (canonical 0x prefix)", () => {
    expect(assetForPythPriceFeedId({ id: pythPriceFeedIds.btc })).toBe("btc");
    expect(assetForPythPriceFeedId({ id: pythPriceFeedIds.eth })).toBe("eth");
    expect(assetForPythPriceFeedId({ id: pythPriceFeedIds.sol })).toBe("sol");
  });

  it("matches ids without the 0x prefix (Hermes' SSE payload omits it)", () => {
    const stripped = pythPriceFeedIds.btc.replace(/^0x/, "");
    expect(assetForPythPriceFeedId({ id: stripped })).toBe("btc");
  });

  it("matches ids regardless of case", () => {
    const upper = pythPriceFeedIds.eth.toUpperCase();
    expect(assetForPythPriceFeedId({ id: upper })).toBe("eth");
  });

  it("returns undefined for unknown ids", () => {
    expect(
      assetForPythPriceFeedId({
        id: "0x0000000000000000000000000000000000000000000000000000000000000000",
      }),
    ).toBeUndefined();
  });
});
