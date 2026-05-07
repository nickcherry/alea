import { computeTradeEconomics } from "@alea/lib/trading/decision/computeTradeEconomics";
import { describe, expect, it } from "bun:test";

describe("computeTradeEconomics", () => {
  it("computes the win/loss math for a low-fee taker fill at price 0.55", () => {
    const econ = computeTradeEconomics({
      stakeUsd: 20,
      fillPrice: 0.55,
      ourProbability: 0.62,
      feeUsd: 0.58,
    });
    expect(econ).not.toBeNull();
    if (econ === null) return;
    expect(econ.shares).toBeCloseTo(20 / 0.55, 6);
    expect(econ.grossWinUsd).toBeCloseTo(20 / 0.55, 6);
    expect(econ.netWinUsd).toBeCloseTo(20 / 0.55 - 0.58 - 20, 6);
    expect(econ.evUsd).toBeCloseTo(
      0.62 * (20 / 0.55 - 0.58 - 20) - 0.38 * 20,
      6,
    );
    expect(econ.rewardRiskRatio).toBeCloseTo((20 / 0.55 - 0.58 - 20) / 20, 6);
  });

  it("returns negative reward-risk for a high-price low-payoff trade", () => {
    const econ = computeTradeEconomics({
      stakeUsd: 20,
      fillPrice: 0.85,
      ourProbability: 0.9,
      feeUsd: 0.21,
    });
    expect(econ).not.toBeNull();
    if (econ === null) return;
    // 20 / 0.85 ≈ 23.53 shares -> 23.53 - 0.21 - 20 ≈ 3.32 USD net win
    // RR = 3.32 / 20 ≈ 0.166 (below the 0.20 floor)
    expect(econ.netWinUsd).toBeGreaterThan(3);
    expect(econ.netWinUsd).toBeLessThan(4);
    expect(econ.rewardRiskRatio).toBeLessThan(0.2);
  });

  it("treats maker fills (fee = 0) correctly", () => {
    const econ = computeTradeEconomics({
      stakeUsd: 20,
      fillPrice: 0.5,
      ourProbability: 0.6,
      feeUsd: 0,
    });
    expect(econ).not.toBeNull();
    if (econ === null) return;
    // 40 shares, $20 net win, RR = 1.0
    expect(econ.netWinUsd).toBeCloseTo(20, 9);
    expect(econ.rewardRiskRatio).toBeCloseTo(1, 9);
    // EV = 0.6*20 - 0.4*20 = 4
    expect(econ.evUsd).toBeCloseTo(4, 9);
  });

  it("returns null for fill prices outside (0, 1)", () => {
    expect(
      computeTradeEconomics({
        stakeUsd: 20,
        fillPrice: 0,
        ourProbability: 0.6,
        feeUsd: 0,
      }),
    ).toBeNull();
    expect(
      computeTradeEconomics({
        stakeUsd: 20,
        fillPrice: 1,
        ourProbability: 0.6,
        feeUsd: 0,
      }),
    ).toBeNull();
    expect(
      computeTradeEconomics({
        stakeUsd: 20,
        fillPrice: -0.1,
        ourProbability: 0.6,
        feeUsd: 0,
      }),
    ).toBeNull();
  });

  it("returns null for non-finite or out-of-range inputs", () => {
    expect(
      computeTradeEconomics({
        stakeUsd: 20,
        fillPrice: NaN,
        ourProbability: 0.6,
        feeUsd: 0,
      }),
    ).toBeNull();
    expect(
      computeTradeEconomics({
        stakeUsd: 0,
        fillPrice: 0.5,
        ourProbability: 0.6,
        feeUsd: 0,
      }),
    ).toBeNull();
    expect(
      computeTradeEconomics({
        stakeUsd: 20,
        fillPrice: 0.5,
        ourProbability: 1.5,
        feeUsd: 0,
      }),
    ).toBeNull();
  });
});
