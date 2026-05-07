import {
  type CalibrationOrder,
  calibrateEvRrGate,
  estimateTakerFeeUsd,
  evaluateGateCell,
  POLYMARKET_TAKER_FEE_RATE,
} from "@alea/lib/trading/replay/calibration/calibrateEvRrGate";
import { describe, expect, it } from "bun:test";

function makeOrder(
  overrides: Partial<CalibrationOrder> & {
    readonly fillPrice?: number;
    readonly modelProbability?: number;
    readonly side?: CalibrationOrder["side"];
    readonly winningSide?: CalibrationOrder["winningSide"];
  } = {},
): CalibrationOrder {
  const fillPrice = overrides.fillPrice ?? 0.6;
  const stake = 20;
  return {
    asset: "btc",
    side: overrides.side ?? "up",
    modelProbability: overrides.modelProbability ?? 0.65,
    taker: {
      fillPrice,
      sharesIfFilled: stake / fillPrice,
      costUsd: stake,
    },
    winningSide: overrides.winningSide ?? "up",
    ...overrides,
  };
}

describe("estimateTakerFeeUsd", () => {
  it("matches Polymarket's `shares × feeRate × price × (1−price)` formula", () => {
    const fee = estimateTakerFeeUsd({
      shares: 27.16697,
      fillPrice: 0.736188,
      feeRate: POLYMARKET_TAKER_FEE_RATE,
    });
    // Cross-checked against /activity: usdcSize 20.369327 vs
    // size*price 20.000800 → fee ≈ $0.369.
    expect(fee).toBeGreaterThan(0.36);
    expect(fee).toBeLessThan(0.38);
  });

  it("returns 0 for fee-free configurations", () => {
    expect(
      estimateTakerFeeUsd({ shares: 30, fillPrice: 0.5, feeRate: 0 }),
    ).toBe(0);
  });

  it("returns 0 for nonsense inputs", () => {
    expect(
      estimateTakerFeeUsd({ shares: 0, fillPrice: 0.5, feeRate: 0.07 }),
    ).toBe(0);
    expect(
      estimateTakerFeeUsd({ shares: 30, fillPrice: 0, feeRate: 0.07 }),
    ).toBe(0);
    expect(
      estimateTakerFeeUsd({ shares: 30, fillPrice: 1, feeRate: 0.07 }),
    ).toBe(0);
  });
});

describe("evaluateGateCell", () => {
  it("includes every order when both gates are −Infinity", () => {
    const orders = [
      makeOrder({ winningSide: "up" }),
      makeOrder({ winningSide: "down" }),
      makeOrder({ winningSide: "up" }),
    ];
    const stats = evaluateGateCell({
      orders,
      minEvUsd: Number.NEGATIVE_INFINITY,
      minRewardRiskRatio: Number.NEGATIVE_INFINITY,
    });
    expect(stats.taken).toBe(3);
    expect(stats.wins).toBe(2);
    expect(stats.winRate).toBeCloseTo(2 / 3, 6);
  });

  it("filters out high-fillPrice trades when MIN_RR is tight", () => {
    const orders = [
      makeOrder({ fillPrice: 0.55, winningSide: "up" }),
      makeOrder({ fillPrice: 0.85, winningSide: "up" }),
      makeOrder({ fillPrice: 0.5, winningSide: "up" }),
    ];
    const stats = evaluateGateCell({
      orders,
      minEvUsd: Number.NEGATIVE_INFINITY,
      minRewardRiskRatio: 0.4,
    });
    // RR 0.40 implies fillPrice ceiling ≈ 0.70 — the 0.85 entry is
    // excluded; 0.55 and 0.50 pass.
    expect(stats.taken).toBe(2);
  });

  it("filters orders without venue-truth winning side", () => {
    const orders = [
      makeOrder({ winningSide: null }),
      makeOrder({ winningSide: "up" }),
    ];
    const stats = evaluateGateCell({
      orders,
      minEvUsd: Number.NEGATIVE_INFINITY,
      minRewardRiskRatio: Number.NEGATIVE_INFINITY,
    });
    expect(stats.taken).toBe(1);
  });

  it("computes per-trade PnL using gross win minus stake minus fee", () => {
    const orders = [makeOrder({ fillPrice: 0.5, winningSide: "up" })];
    const stats = evaluateGateCell({
      orders,
      minEvUsd: Number.NEGATIVE_INFINITY,
      minRewardRiskRatio: Number.NEGATIVE_INFINITY,
    });
    // shares = 40, grossWin = 40, fee = 40*0.07*0.5*0.5 = 0.70,
    // pnl = 40 - 20 - 0.70 = 19.30.
    expect(stats.pnlUsd).toBeCloseTo(19.3, 4);
    expect(stats.pnlPerTrade).toBeCloseTo(19.3, 4);
  });

  it("computes a loss as -stake-fee", () => {
    const orders = [makeOrder({ fillPrice: 0.6, winningSide: "down" })];
    const stats = evaluateGateCell({
      orders,
      minEvUsd: Number.NEGATIVE_INFINITY,
      minRewardRiskRatio: Number.NEGATIVE_INFINITY,
    });
    // shares = 33.33, fee = 33.33*0.07*0.6*0.4 = 0.56,
    // pnl = -20 - 0.56 = -20.56.
    expect(stats.pnlUsd).toBeCloseTo(-20.56, 2);
  });
});

describe("calibrateEvRrGate", () => {
  it("emits one cell per (ev, rr) tuple in row-major order", () => {
    const orders = [makeOrder({ winningSide: "up" })];
    const result = calibrateEvRrGate({
      orders,
      evGrid: [0, 1, 2],
      rrGrid: [0.1, 0.2],
    });
    expect(result.cells).toHaveLength(6);
    expect(result.cells.map((cell) => cell.minEvUsd)).toEqual([
      0, 0, 1, 1, 2, 2,
    ]);
    expect(result.cells.map((cell) => cell.minRewardRiskRatio)).toEqual([
      0.1, 0.2, 0.1, 0.2, 0.1, 0.2,
    ]);
  });

  it("counts evaluable orders independently from total orders", () => {
    const orders = [
      makeOrder({ winningSide: "up" }),
      makeOrder({ winningSide: null }),
    ];
    const result = calibrateEvRrGate({
      orders,
      evGrid: [0],
      rrGrid: [0],
    });
    expect(result.orderCount).toBe(2);
    expect(result.evaluableOrderCount).toBe(1);
  });
});
