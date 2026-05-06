import { lookupAllProbabilities } from "@alea/lib/trading/lookupProbability";
import type { ProbabilityTable } from "@alea/lib/trading/types";
import { describe, expect, it } from "bun:test";

const baseTable: ProbabilityTable = {
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
          regime: "low_vol",
          windowShare: 0.6,
          avgLeadPp: 2.4,
          surface: {
            byRemaining: {
              1: [
                { distanceBp: 1, samples: 500, probability: 0.95 },
                { distanceBp: 5, samples: 300, probability: 0.85 },
              ],
              2: [],
              3: [],
              4: [{ distanceBp: 1, samples: 1000, probability: 0.7 }],
            },
          },
        },
        {
          algoId: "trend_x_vol_6",
          regime: "with_trend_low_vol",
          windowShare: 0.2,
          avgLeadPp: 1.6,
          surface: {
            byRemaining: {
              1: [{ distanceBp: 1, samples: 200, probability: 0.78 }],
              2: [],
              3: [],
              4: [],
            },
          },
        },
      ],
    },
  ],
};

describe("lookupAllProbabilities", () => {
  it("returns one entry per (algo, regime) where the snapshot's classification matches and the bucket is populated", () => {
    const lookups = lookupAllProbabilities({
      table: baseTable,
      asset: "btc",
      regimesByAlgoId: new Map([
        ["vol_only_3", "low_vol"],
        ["trend_x_vol_6", "with_trend_low_vol"],
      ]),
      remaining: 1,
      distanceBp: 1,
    });
    expect(lookups).toHaveLength(2);
    const byAlgo = new Map(lookups.map((l) => [l.algoId, l]));
    expect(byAlgo.get("vol_only_3")?.probability).toBe(0.95);
    expect(byAlgo.get("trend_x_vol_6")?.probability).toBe(0.78);
  });

  it("skips entries where the snapshot's classification under the algo doesn't match the table's regime", () => {
    const lookups = lookupAllProbabilities({
      table: baseTable,
      asset: "btc",
      regimesByAlgoId: new Map([
        ["vol_only_3", "high_vol"], // not a leading regime, no entry exists
        ["trend_x_vol_6", "with_trend_low_vol"],
      ]),
      remaining: 1,
      distanceBp: 1,
    });
    expect(lookups).toHaveLength(1);
    expect(lookups[0]?.algoId).toBe("trend_x_vol_6");
  });

  it("skips entries where the algo isn't in the snapshot's regimesByAlgoId at all (e.g. classifier returned null)", () => {
    const lookups = lookupAllProbabilities({
      table: baseTable,
      asset: "btc",
      regimesByAlgoId: new Map([["vol_only_3", "low_vol"]]),
      remaining: 1,
      distanceBp: 1,
    });
    expect(lookups).toHaveLength(1);
    expect(lookups[0]?.algoId).toBe("vol_only_3");
  });

  it("skips entries where the bucket at this distance is absent (sparse bp range)", () => {
    const lookups = lookupAllProbabilities({
      table: baseTable,
      asset: "btc",
      regimesByAlgoId: new Map([
        ["vol_only_3", "low_vol"],
        ["trend_x_vol_6", "with_trend_low_vol"],
      ]),
      remaining: 1,
      distanceBp: 5,
    });
    // Only vol_only_3 has a bucket at distanceBp=5 / remaining=1.
    expect(lookups).toHaveLength(1);
    expect(lookups[0]?.algoId).toBe("vol_only_3");
    expect(lookups[0]?.distanceBp).toBe(5);
  });

  it("returns an empty array for unknown assets", () => {
    expect(
      lookupAllProbabilities({
        table: baseTable,
        asset: "eth",
        regimesByAlgoId: new Map([["vol_only_3", "low_vol"]]),
        remaining: 1,
        distanceBp: 1,
      }),
    ).toEqual([]);
  });

  it("returns an empty array when no algo classifications were provided", () => {
    expect(
      lookupAllProbabilities({
        table: baseTable,
        asset: "btc",
        regimesByAlgoId: new Map(),
        remaining: 1,
        distanceBp: 1,
      }),
    ).toEqual([]);
  });
});
