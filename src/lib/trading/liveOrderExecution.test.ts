import { buildLiveMakerLimitBuyOrder } from "@alea/lib/trading/liveOrderExecution";
import type { TradableMarket } from "@alea/lib/trading/vendor/types";
import { Side } from "@polymarket/clob-client-v2";
import { describe, expect, it } from "bun:test";

describe("buildLiveMakerLimitBuyOrder", () => {
  it("builds a post-only maker BUY request for the predicted-side token", () => {
    const request = buildLiveMakerLimitBuyOrder({
      market: market({ tickSize: 0.001, negRisk: true }),
      period: "5m",
      prediction: "d",
      targetTsMs: 1_800_000,
      limitPrice: 0.497,
    });

    expect(request.userOrder).toEqual({
      tokenID: "DOWN",
      price: 0.497,
      size: 40.2414,
      side: Side.BUY,
      expiration: 2100,
    });
    expect(request.options).toEqual({ tickSize: "0.001", negRisk: true });
  });

  it("falls back to the penny tick when metadata is missing", () => {
    const request = buildLiveMakerLimitBuyOrder({
      market: market({ tickSize: null, negRisk: null }),
      period: "15m",
      prediction: "u",
      targetTsMs: 1_800_000,
      limitPrice: 0.5,
    });

    expect(request.userOrder.tokenID).toBe("UP");
    expect(request.userOrder.size).toBe(40);
    expect(request.userOrder.expiration).toBe(2700);
    expect(request.options).toEqual({ tickSize: "0.01" });
  });
});

function market({
  tickSize,
  negRisk,
}: {
  readonly tickSize: number | null;
  readonly negRisk: boolean | null;
}): TradableMarket {
  return {
    asset: "btc",
    vendorRef: "COND",
    upRef: "UP",
    downRef: "DOWN",
    tickSize,
    negRisk,
  };
}
