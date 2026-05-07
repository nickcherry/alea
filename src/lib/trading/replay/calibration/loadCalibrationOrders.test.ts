import { loadCalibrationOrdersFromText } from "@alea/lib/trading/replay/calibration/loadCalibrationOrders";
import { describe, expect, it } from "bun:test";

const sessionStart = JSON.stringify({
  type: "session_start",
  atMs: 1_000_000,
  config: {
    vendor: "polymarket-replay",
    priceSource: "binance-perp",
    assets: ["btc", "eth"],
    minEdge: 0.05,
    stakeUsd: 20,
    tableRange: "2024..2026",
    telegramAlerts: false,
    replay: { fromMs: 1_000_000, toMs: 2_000_000 },
  },
});

const orderRecordWithTakerAndOutcome = {
  id: "order-1",
  asset: "btc",
  side: "up",
  modelProbability: 0.7,
  edge: 0.1,
  limitPrice: 0.6,
  sharesIfFilled: 33.33,
  takerCounterfactual: {
    askPrice: 0.62,
    sharesIfFilled: 32.25,
    costUsd: 19.99,
  },
  officialOutcome: "up",
  replayOutcome: { winningSide: "up" },
};

const orderRecordWithoutTaker = {
  id: "order-2",
  asset: "eth",
  side: "down",
  modelProbability: 0.6,
  takerCounterfactual: null,
  officialOutcome: "down",
};

const orderRecordWithoutOutcome = {
  id: "order-3",
  asset: "btc",
  side: "up",
  modelProbability: 0.65,
  takerCounterfactual: {
    askPrice: 0.55,
    sharesIfFilled: 36.36,
    costUsd: 20,
  },
  officialOutcome: null,
  replayOutcome: null,
};

const sessionStop = JSON.stringify({ type: "session_stop", atMs: 2_000_000 });

describe("loadCalibrationOrdersFromText", () => {
  it("drops orders without takerCounterfactual but keeps unresolved-outcome orders with winningSide=null", () => {
    const window = JSON.stringify({
      type: "window_finalized",
      atMs: 1_500_000,
      windowStartMs: 1_500_000,
      windowEndMs: 1_800_000,
      orders: [
        orderRecordWithTakerAndOutcome,
        orderRecordWithoutTaker,
        orderRecordWithoutOutcome,
      ],
    });
    const text = [sessionStart, window, sessionStop].join("\n");
    const result = loadCalibrationOrdersFromText({ text });
    expect(result.orders).toHaveLength(2);
    const resolved = result.orders.find((o) => o.winningSide !== null);
    expect(resolved).toBeDefined();
    expect(resolved?.asset).toBe("btc");
    expect(resolved?.side).toBe("up");
    expect(resolved?.modelProbability).toBeCloseTo(0.7, 6);
    expect(resolved?.taker.fillPrice).toBeCloseTo(0.62, 6);
    const unresolved = result.orders.find((o) => o.winningSide === null);
    expect(unresolved).toBeDefined();
  });

  it("falls back to officialOutcome when replayOutcome is missing", () => {
    const orderWithoutReplay = {
      ...orderRecordWithTakerAndOutcome,
      replayOutcome: undefined,
    };
    const window = JSON.stringify({
      type: "window_finalized",
      atMs: 1_500_000,
      windowStartMs: 1_500_000,
      windowEndMs: 1_800_000,
      orders: [orderWithoutReplay],
    });
    const text = [sessionStart, window].join("\n");
    const result = loadCalibrationOrdersFromText({ text });
    expect(result.orders).toHaveLength(1);
    expect(result.orders[0]?.winningSide).toBe("up");
  });

  it("captures the session config when available", () => {
    const text = [sessionStart, sessionStop].join("\n");
    const result = loadCalibrationOrdersFromText({ text });
    expect(result.sessionConfig).not.toBeNull();
    expect(result.sessionConfig?.fromMs).toBe(1_000_000);
    expect(result.sessionConfig?.toMs).toBe(2_000_000);
    expect(result.sessionConfig?.assets).toEqual(["btc", "eth"]);
  });

  it("collects parse errors but keeps going", () => {
    const text = ["{not json", sessionStart].join("\n");
    const result = loadCalibrationOrdersFromText({ text });
    expect(result.parseErrors).toHaveLength(1);
    expect(result.sessionConfig).not.toBeNull();
  });
});
