import { placePolymarketTakerMarketBuy } from "@alea/lib/trading/vendor/polymarket/placeTakerMarketBuy";
import type { TradableMarket } from "@alea/lib/trading/vendor/types";
import {
  type ClobClient,
  type CreateOrderOptions,
  OrderType,
  Side,
  type UserMarketOrderV2,
} from "@polymarket/clob-client-v2";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

const originalDateNow = Date.now;

const market: TradableMarket = {
  asset: "btc",
  windowStartUnixSeconds: 1_777_900_200,
  windowStartMs: 1_777_900_200_000,
  windowEndMs: 1_777_900_500_000,
  vendorRef: "condition",
  upRef: "UP_TOKEN",
  downRef: "DOWN_TOKEN",
  acceptingOrders: true,
};

const constraints = {
  priceTickSize: 0.01,
  tickSize: "0.01" as const,
  minOrderSize: 1,
  minimumOrderAgeSeconds: 0,
  makerBaseFeeBps: 0,
  takerBaseFeeBps: 720,
  feesTakerOnly: true,
  negRisk: true,
  rfqEnabled: false,
  takerOrderDelayEnabled: false,
};

describe("placePolymarketTakerMarketBuy", () => {
  beforeEach(() => {
    Date.now = () => market.windowStartMs + 120_000;
  });

  afterEach(() => {
    Date.now = originalDateNow;
  });

  it("posts a FAK market buy capped by the provided limit price", async () => {
    const calls: Array<{
      readonly order: UserMarketOrderV2;
      readonly options: Partial<CreateOrderOptions> | undefined;
      readonly orderType: OrderType | undefined;
    }> = [];
    const client = {
      async createAndPostMarketOrder(
        order: UserMarketOrderV2,
        options?: Partial<CreateOrderOptions>,
        orderType?: OrderType,
      ): Promise<unknown> {
        calls.push({ order, options, orderType });
        return {
          success: true,
          orderID: "0xorder",
          status: "matched",
        };
      },
    } as unknown as ClobClient;

    const placed = await placePolymarketTakerMarketBuy({
      client,
      market,
      side: "up",
      limitPrice: 0.611,
      sharesIfFilled: 32.5,
      stakeUsd: 20,
      constraints,
    });

    expect(calls).toEqual([
      {
        order: {
          tokenID: "UP_TOKEN",
          amount: 20,
          side: Side.BUY,
          price: 0.62,
          orderType: OrderType.FAK,
        },
        options: { negRisk: true, tickSize: "0.01" },
        orderType: OrderType.FAK,
      },
    ]);
    expect(placed).toEqual({
      orderId: null,
      side: "up",
      outcomeRef: "UP_TOKEN",
      limitPrice: 0.62,
      sharesIfFilled: 32.5,
      feeRateBps: 720,
      orderType: "FAK",
      expiresAtMs: null,
      placedAtMs: Date.now(),
    });
  });

  it("rejects expected fills below the venue minimum", async () => {
    const client = {} as ClobClient;

    expect(
      placePolymarketTakerMarketBuy({
        client,
        market,
        side: "up",
        limitPrice: 0.6,
        sharesIfFilled: 0.5,
        stakeUsd: 20,
        constraints,
      }),
    ).rejects.toThrow("below venue minimum");
  });
});
