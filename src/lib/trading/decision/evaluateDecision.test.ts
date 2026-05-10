import { evaluateDecision } from "@alea/lib/trading/decision/evaluateDecision";
import type { ProbabilityTable } from "@alea/lib/trading/types";
import { describe, expect, it } from "bun:test";

const WINDOW_START = Date.UTC(2026, 0, 1, 0, 0, 0);
const ONE_MINUTE = 60_000;

// Fixture: vol_only_3 / mid_vol is the leading table for the BTC
// sample. The other buckets are excluded (they lag baseline at gen
// time, by definition not persisted). The decision evaluator should
// only fire when the snapshot's vol_only_3 classification is `mid_vol`.
const table: ProbabilityTable = {
  command: "trading:gen-probability-table",
  schemaVersion: 1,
  generatedAtMs: 0,
  series: { source: "binance", product: "perp", timeframe: "5m" },
  minBucketSamples: 200,
  trainingRangeMs: { firstWindowMs: 0, lastWindowMs: 0 },
  assets: [
    {
      asset: "btc",
      windowCount: 1000,
      leadingTables: [
        {
          algoId: "vol_only_3",
          regime: "mid_vol",
          windowShare: 0.6,
          avgLeadPp: 2.4,
          surface: {
            byRemaining: {
              1: [],
              2: [],
              3: [
                { distanceBp: 5, samples: 800, probability: 0.85 },
                { distanceBp: 10, samples: 500, probability: 0.92 },
              ],
              4: [],
            },
          },
        },
        {
          algoId: "trend_x_vol_6",
          regime: "with_trend_low_vol",
          windowShare: 0.18,
          avgLeadPp: 1.8,
          surface: {
            byRemaining: {
              1: [],
              2: [],
              3: [{ distanceBp: 5, samples: 600, probability: 0.78 }],
              4: [],
            },
          },
        },
      ],
    },
  ],
};

// Regime classifier input populated so vol_only_3 → mid_vol and
// trend_x_vol_6 → with_trend_low_vol (both leading tables in the
// fixture). EMA20 > EMA50 with separation ≥ 0.5 × ATR-14 = trending up;
// ATR-14 / ATR-50 = 1.0, between vol_only_3's 0.7/1.3 cuts → mid_vol;
// trend_x_vol_6 still lands in low_vol (its 1.0 cut is inclusive on the
// low side).
const baseRegimeInput = {
  leadingSide: "up" as const,
  ema20: 101,
  ema50: 100,
  atr14: 1,
  atr50: 1,
  atr3: 1,
  rsi14: 50,
  prev5mDirection: "up" as const,
  rsiDivergence5mW3: null,
  rsiDivergence5mW5: null,
  rsiDivergence5mW7: null,
  rsiDivergence15mW3: null,
  rsiDivergence15mW5: null,
  rsiDivergence15mW7: null,
};

const baseInputs = {
  asset: "btc" as const,
  windowStartMs: WINDOW_START,
  nowMs: WINDOW_START + 2 * ONE_MINUTE, // [+2m, +3m) → remaining = 3
  line: 100,
  currentPrice: 100.05, // distance = 0.05, distanceBp = 5
  regimeInput: baseRegimeInput,
  upBestBid: 0.6,
  downBestBid: 0.1,
  upTokenId: "TOKEN_UP",
  downTokenId: "TOKEN_DOWN",
  table,
  minEdge: 0.05,
};

describe("evaluateDecision", () => {
  it("trades the (algo, side) tuple with the highest edge across all leading tables", () => {
    const decision = evaluateDecision(baseInputs);
    expect(decision.kind).toBe("trade");
    if (decision.kind !== "trade") {
      return;
    }
    expect(decision.snapshot.distanceBp).toBe(5);
    expect(decision.snapshot.remaining).toBe(3);
    // Both algos classify; both have a populated bucket at (3m left, 5bp).
    // vol_only_3/mid_vol: P(up) = 0.85 → edge_up = 0.85 - 0.60 = 0.25
    // trend_x_vol_6/with_trend_low_vol: P(up) = 0.78 → edge_up = 0.18
    // Maximum edge across all (lookup, side) → vol_only_3 / up @ 0.25.
    expect(decision.winningRegime.algoId).toBe("vol_only_3");
    expect(decision.winningRegime.regime).toBe("mid_vol");
    expect(decision.chosen.side).toBe("up");
    expect(decision.chosen.bid).toBe(0.6);
    expect(decision.chosen.edge).toBeCloseTo(0.85 - 0.6, 9);
    expect(decision.other.side).toBe("down");
  });

  it("returns warmup when no algo classifies (buffer hasn't seeded)", () => {
    const decision = evaluateDecision({
      ...baseInputs,
      regimeInput: {
        leadingSide: "up",
        ema20: null,
        ema50: null,
        atr14: null,
        atr50: null,
        atr3: null,
        rsi14: null,
        prev5mDirection: null,
        rsiDivergence5mW3: null,
        rsiDivergence5mW5: null,
        rsiDivergence5mW7: null,
        rsiDivergence15mW3: null,
        rsiDivergence15mW5: null,
        rsiDivergence15mW7: null,
      },
    });
    expect(decision.kind).toBe("skip");
    if (decision.kind === "skip") {
      expect(decision.reason).toBe("warmup");
      // Snapshot is populated on warmup; regimesByAlgoId is empty.
      expect(decision.snapshot?.regimesByAlgoId.size).toBe(0);
    }
  });

  it("returns out-of-window past +5m", () => {
    const decision = evaluateDecision({
      ...baseInputs,
      nowMs: WINDOW_START + 5 * ONE_MINUTE,
    });
    expect(decision.kind).toBe("skip");
    if (decision.kind === "skip") {
      expect(decision.reason).toBe("out-of-window");
    }
  });

  it("returns out-of-window during the pre-snapshot first minute", () => {
    const decision = evaluateDecision({
      ...baseInputs,
      nowMs: WINDOW_START + 30_000, // [+0m, +1m) → no snapshot yet
    });
    expect(decision.kind).toBe("skip");
    if (decision.kind === "skip") {
      expect(decision.reason).toBe("out-of-window");
    }
  });

  it("returns no-bucket when no leading table has data at this (remaining, distance)", () => {
    const decision = evaluateDecision({
      ...baseInputs,
      currentPrice: 100.5, // distanceBp = 50, no entry at any leading table
    });
    expect(decision.kind).toBe("skip");
    if (decision.kind === "skip") {
      expect(decision.reason).toBe("no-bucket");
      expect(decision.snapshot?.distanceBp).toBe(50);
    }
  });

  it("returns no-bid when both YES tokens have empty bid sides", () => {
    const decision = evaluateDecision({
      ...baseInputs,
      upBestBid: null,
      downBestBid: null,
    });
    expect(decision.kind).toBe("skip");
    if (decision.kind === "skip") {
      expect(decision.reason).toBe("no-bid");
      expect(decision.up?.bid).toBeNull();
    }
  });

  it("returns thin-edge when no (algo, side) tuple clears minEdge", () => {
    // Bids tuned so the maximum edge across all four (algo, side)
    // tuples is below 0.05:
    //   vol_only_3 P(up)=0.85, P(down)=0.15
    //   trend_x_vol_6 P(up)=0.78, P(down)=0.22
    //   upBid 0.81 → max edge_up = 0.04 (vol_only_3)
    //   downBid 0.18 → max edge_down = 0.04 (trend_x_vol_6)
    const decision = evaluateDecision({
      ...baseInputs,
      upBestBid: 0.81,
      downBestBid: 0.18,
    });
    expect(decision.kind).toBe("skip");
    if (decision.kind === "skip") {
      expect(decision.reason).toBe("thin-edge");
    }
  });

  it("returns low-confidence when the winning side's probability is below MIN_MODEL_PROBABILITY", () => {
    // distanceBp=10, only vol_only_3 has data here:
    //   P(up wins) = 0.92 → ourP_down = 0.08
    //   downBid = 0.01 → edge_down = 0.07 (clears minEdge)
    //   But ourP_down 0.08 < MIN_MODEL_PROBABILITY 0.55 → refuse.
    const decision = evaluateDecision({
      ...baseInputs,
      currentPrice: 100.1,
      upBestBid: 0.95,
      downBestBid: 0.01,
    });
    expect(decision.kind).toBe("skip");
    if (decision.kind === "skip") {
      expect(decision.reason).toBe("low-confidence");
    }
  });

  it("falls back to a different leading table when the primary algo's regime doesn't match", () => {
    // Force vol_only_3 into the lagging (non-persisted) regime by
    // bumping atr14/atr50 to ratio > 1 → high_vol. trend_x_vol_6
    // would classify into with_trend_high_vol (no leading table) → no
    // matching tables → expect no-bucket.
    const decision = evaluateDecision({
      ...baseInputs,
      regimeInput: { ...baseRegimeInput, atr14: 2, atr50: 1 },
    });
    expect(decision.kind).toBe("skip");
    if (decision.kind === "skip") {
      expect(decision.reason).toBe("no-bucket");
    }
  });

  it("returns thin-rr when EV passes but the fill price gives a tiny payoff vs stake", () => {
    // distanceBp=10 → only vol_only_3 has data: P(up)=0.92, P(down)=0.08.
    // Up-side fillPrice 0.78 → shares ≈ 25.64, gross win ≈ $25.64,
    // fee 700bps ≈ $0.24, net win ≈ $5.40 → RR ≈ 0.27.
    // EV = 0.92 * 5.40 - 0.08 * 20 = 3.37 → clears the override-low
    // EV floor here, but RR 0.27 < the 0.30 RR floor → thin-rr.
    //
    // Uses explicit `minEvUsd` / `minRewardRiskRatio` overrides so the
    // test exercises the gate LOGIC and isn't coupled to the current
    // production constants (which the operator tunes regularly).
    const decision = evaluateDecision({
      ...baseInputs,
      currentPrice: 100.1, // distanceBp = 10
      upBestBid: 0.78,
      downBestBid: 0.05,
      upFillPrice: 0.78,
      downFillPrice: 0.05,
      upFeeUsd: 0.24,
      downFeeUsd: 0,
      stakeUsd: 20,
      minEvUsd: 1.0,
      minRewardRiskRatio: 0.3,
    });
    expect(decision.kind).toBe("skip");
    if (decision.kind === "skip") {
      expect(decision.reason).toBe("thin-rr");
    }
  });

  it("returns thin-ev when the modeled edge clears minEdge but EV in USD is below the floor", () => {
    // distanceBp=10 → vol_only_3 P(up)=0.92, P(down)=0.08.
    // Up-side bid 0.85 → edge 0.07 (clears minEdge 0.05).
    // P=0.92 ≥ MIN_MODEL_PROBABILITY 0.55.
    // Taker fillPrice 0.92 → shares ≈ 21.74, gross win ≈ $21.74,
    // fee = $0.20, net win ≈ $1.54 → RR ≈ 0.077 (also below 0.20).
    // We expect thin-ev to fire FIRST (the gate runs before thin-rr).
    // EV = 0.92 * 1.54 - 0.08 * 20 = -0.18 → fails $1 floor.
    const decision = evaluateDecision({
      ...baseInputs,
      currentPrice: 100.1,
      upBestBid: 0.85,
      downBestBid: 0.05,
      upFillPrice: 0.92,
      downFillPrice: 0.05,
      upFeeUsd: 0.2,
      downFeeUsd: 0,
      stakeUsd: 20,
    });
    expect(decision.kind).toBe("skip");
    if (decision.kind === "skip") {
      expect(decision.reason).toBe("thin-ev");
    }
  });

  it("attaches per-side economics on a successful trade decision", () => {
    const decision = evaluateDecision({
      ...baseInputs,
      upFillPrice: 0.6,
      downFillPrice: 0.1,
      upFeeUsd: 0.84,
      downFeeUsd: 0,
      stakeUsd: 20,
    });
    expect(decision.kind).toBe("trade");
    if (decision.kind !== "trade") return;
    expect(decision.chosen.economics).not.toBeNull();
    if (decision.chosen.economics === null) return;
    expect(decision.chosen.economics.fillPrice).toBe(0.6);
    expect(decision.chosen.economics.shares).toBeCloseTo(20 / 0.6, 6);
    // grossWin 33.33 - fee 0.84 - stake 20 = $12.49 net win
    expect(decision.chosen.economics.netWinUsd).toBeCloseTo(12.49, 2);
    // EV = 0.85 * 12.49 - 0.15 * 20 ≈ $7.62
    expect(decision.chosen.economics.evUsd).toBeGreaterThan(7);
  });

  it("falls back to bid as the fill price when the caller does not supply fillPrice (legacy maker path)", () => {
    // No upFillPrice / downFillPrice → evaluator uses bid (0.6 / 0.1)
    // and zero fee. Equivalent to maker-mode placement: shares = 33.33,
    // grossWin = $33.33, netWin = $13.33, EV = 0.85*13.33 - 0.15*20 ≈ $8.33.
    const decision = evaluateDecision(baseInputs);
    expect(decision.kind).toBe("trade");
    if (decision.kind !== "trade") return;
    expect(decision.chosen.economics).not.toBeNull();
    if (decision.chosen.economics === null) return;
    expect(decision.chosen.economics.fillPrice).toBe(0.6);
    expect(decision.chosen.economics.feeUsd).toBe(0);
  });
});
