import {
  buildLiveMakerLimitBuyOrder,
  createLiveOrderExecutor,
} from "@alea/lib/trading/liveOrderExecution";
import type { PolymarketMarketDiscoveryCache } from "@alea/lib/trading/vendor/polymarket/marketDiscoveryCache";
import type {
  MarketDataEvent,
  MarketDataStreamCallbacks,
  MarketDataStreamHandle,
  TradableMarket,
} from "@alea/lib/trading/vendor/types";
import { type ClobClient, OrderType, Side } from "@polymarket/clob-client-v2";
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
    expect(request.options).toEqual({ tickSize: "0.01", negRisk: false });
  });

  it("rejects non-finite limit prices before reaching the SDK", () => {
    expect(() =>
      buildLiveMakerLimitBuyOrder({
        market: market({ tickSize: 0.01, negRisk: false }),
        period: "5m",
        prediction: "u",
        targetTsMs: 1_800_000,
        limitPrice: Number.NaN,
      }),
    ).toThrow(/invalid live order limit price/);
  });
});

describe("createLiveOrderExecutor", () => {
  it("starts placement immediately after a pre-open decision with one tick below 50c when no quote is available", async () => {
    const calls: PostedOrder[] = [];
    const executor = createLiveOrderExecutor({
      client: fakeClient({
        calls,
        responses: [{ success: true, orderID: "order-1" }],
      }),
      marketDiscovery: fakeMarketDiscovery({
        market: market({ tickSize: 0.01, negRisk: false }),
      }),
      log: () => {},
      now: () => 1_795_000,
      sleep: async () => {},
      streamMarketData: fakeStreamMarketData(),
    });

    await executor.scheduleOrder({
      asset: "btc",
      period: "5m",
      prediction: "u",
      targetTsMs: 1_800_000,
      confidence: 0.6,
    });

    await waitFor(() => calls.length === 1);
    expect(calls[0]?.userOrder.price).toBe(0.49);
    expect(calls[0]?.orderType).toBe(OrderType.GTD);
    expect(calls[0]?.postOnly).toBe(true);
  });

  it("ratchets a post-only cross rejection down one tick and resubmits", async () => {
    const calls: PostedOrder[] = [];
    const executor = createLiveOrderExecutor({
      client: fakeClient({
        calls,
        responses: [
          {
            success: false,
            error: "invalid post-only order: order crosses book",
            status: 400,
          },
          { success: true, orderID: "order-2" },
        ],
      }),
      marketDiscovery: fakeMarketDiscovery({
        market: market({ tickSize: 0.01, negRisk: false }),
      }),
      log: () => {},
      now: () => 1_795_000,
      sleep: async () => {},
      streamMarketData: fakeStreamMarketData([
        {
          kind: "best-bid-ask",
          vendorRef: "COND",
          outcomeRef: "UP",
          bestBid: 0.5,
          bestAsk: 0.51,
          atMs: 1_795_000,
        },
      ]),
    });

    await executor.scheduleOrder({
      asset: "btc",
      period: "5m",
      prediction: "u",
      targetTsMs: 1_800_000,
      confidence: 0.6,
    });

    await waitFor(() => calls.length === 2);
    expect(calls.map((call) => call.userOrder.price)).toEqual([0.5, 0.49]);
  });

  it("backs off rate-limit rejections before retrying", async () => {
    const calls: PostedOrder[] = [];
    const sleeps: number[] = [];
    const executor = createLiveOrderExecutor({
      client: fakeClient({
        calls,
        responses: [
          { success: false, error: "too many requests", status: 429 },
          { success: true, orderID: "order-3" },
        ],
      }),
      marketDiscovery: fakeMarketDiscovery({
        market: market({ tickSize: 0.01, negRisk: false }),
      }),
      log: () => {},
      now: () => 1_795_000,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      streamMarketData: fakeStreamMarketData(),
    });

    await executor.scheduleOrder({
      asset: "btc",
      period: "5m",
      prediction: "u",
      targetTsMs: 1_800_000,
      confidence: 0.6,
    });

    await waitFor(() => calls.length === 2);
    expect(sleeps[0]).toBe(500);
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

type CreateAndPostOrderArgs = Parameters<ClobClient["createAndPostOrder"]>;

type PostedOrder = {
  readonly userOrder: CreateAndPostOrderArgs[0];
  readonly orderType: CreateAndPostOrderArgs[2];
  readonly postOnly: CreateAndPostOrderArgs[3];
};

function fakeClient({
  calls,
  responses,
}: {
  readonly calls: PostedOrder[];
  readonly responses: unknown[];
}): ClobClient {
  let responseIndex = 0;
  return {
    createAndPostOrder: async (...args: CreateAndPostOrderArgs) => {
      const [userOrder, _options, orderType, postOnly] = args;
      calls.push({ userOrder, orderType, postOnly });
      return responses[responseIndex++] ?? { success: true };
    },
  } as unknown as ClobClient;
}

function fakeMarketDiscovery({
  market: discoveredMarket,
}: {
  readonly market: TradableMarket;
}): PolymarketMarketDiscoveryCache {
  return {
    warm: () => {},
    get: () => discoveredMarket,
    getOrDiscover: async () => discoveredMarket,
  };
}

function fakeStreamMarketData(events: readonly MarketDataEvent[] = []): (
  input: {
    readonly markets: readonly TradableMarket[];
  } & MarketDataStreamCallbacks,
) => MarketDataStreamHandle {
  return ({ onEvent, onConnect }) => {
    onConnect?.();
    for (const event of events) {
      onEvent(event);
    }
    return { stop: async () => {} };
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("condition was not met");
}
