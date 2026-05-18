import {
  buildLeadTimeDriftPayloadFromAggregateRows,
  type LeadTimeDriftAggregateRow,
} from "@alea/lib/polymarket/dashboard/loadLeadTimeDriftPayload";
import { describe, expect, it } from "bun:test";

const generatedAtMs = 1_778_517_600_000;
const analysisWindowEndExclusiveMs = 1_780_000_000_000;

function aggregateRow(
  overrides: Partial<LeadTimeDriftAggregateRow> &
    Pick<LeadTimeDriftAggregateRow, "asset" | "timeframe" | "leadMinutes">,
): LeadTimeDriftAggregateRow {
  const sampleCount = overrides.sampleCount ?? 100;
  return {
    asset: overrides.asset,
    timeframe: overrides.timeframe,
    leadMinutes: overrides.leadMinutes,
    sampleCount,
    missingCount: overrides.missingCount ?? 5,
    signedMeanBps: overrides.signedMeanBps ?? 0.4,
    absP50Bps: overrides.absP50Bps ?? 1.5,
    absP75Bps: overrides.absP75Bps ?? 2.8,
    absP90Bps: overrides.absP90Bps ?? 4.6,
    absP99Bps: overrides.absP99Bps ?? 9.1,
    withinBpsCounts: overrides.withinBpsCounts ?? [40, 60, 90],
    directionalCount: overrides.directionalCount ?? sampleCount,
    flippedCount: overrides.flippedCount ?? 0,
    firstCandleMs: overrides.firstCandleMs ?? 1_700_000_000_000,
    lastCandleMs: overrides.lastCandleMs ?? 1_770_000_000_000,
  };
}

describe("lead-time drift payload", () => {
  it("returns an empty payload when no 1m candles exist", () => {
    const payload = buildLeadTimeDriftPayloadFromAggregateRows({
      rows: [],
      generatedAtMs,
      analysisWindowEndExclusiveMs,
      hasOneMinuteCandles: false,
    });
    expect(payload.hasOneMinuteCandles).toBe(false);
    expect(payload.breakdowns).toHaveLength(1);
    for (const breakdown of payload.breakdowns) {
      expect(breakdown.slices).toHaveLength(0);
    }
  });

  it("organises market timeframe breakdowns with all-assets rollup first", () => {
    const payload = buildLeadTimeDriftPayloadFromAggregateRows({
      rows: [
        aggregateRow({ asset: "btc", timeframe: "1h", leadMinutes: 5 }),
        aggregateRow({ asset: "btc", timeframe: "1h", leadMinutes: 10 }),
        aggregateRow({ asset: "eth", timeframe: "1h", leadMinutes: 5 }),
      ],
      generatedAtMs,
      analysisWindowEndExclusiveMs,
      hasOneMinuteCandles: true,
    });

    const oneHour = payload.breakdowns.find((b) => b.timeframe === "1h");
    expect(oneHour?.leadMinutes).toEqual([5, 10, 15, 20, 30, 45, 55]);
    expect(oneHour?.slices[0]?.asset).toBeNull();
    expect(oneHour?.slices[0]?.label).toBe("All assets");
    // Per-asset slices follow.
    const btcSlice = oneHour?.slices.find((s) => s.asset === "btc");
    expect(btcSlice?.label).toBe("BTC");
    const ethSlice = oneHour?.slices.find((s) => s.asset === "eth");
    expect(ethSlice?.label).toBe("ETH");
  });

  it("derives threshold shares from the per-row within counts", () => {
    const payload = buildLeadTimeDriftPayloadFromAggregateRows({
      rows: [
        aggregateRow({
          asset: "btc",
          timeframe: "1h",
          leadMinutes: 5,
          sampleCount: 200,
          withinBpsCounts: [100, 150, 190],
        }),
      ],
      generatedAtMs,
      analysisWindowEndExclusiveMs,
      hasOneMinuteCandles: true,
    });
    const oneHour = payload.breakdowns.find((b) => b.timeframe === "1h");
    const btcSlice = oneHour?.slices.find((s) => s.asset === "btc");
    const lead5 = btcSlice?.leads.find((l) => l.leadMinutes === 5);
    expect(lead5?.thresholdShares).toEqual([0.5, 0.75, 0.95]);
  });

  it("returns null shares and percentiles when a lead has no samples", () => {
    const payload = buildLeadTimeDriftPayloadFromAggregateRows({
      rows: [
        aggregateRow({
          asset: "btc",
          timeframe: "1h",
          leadMinutes: 5,
        }),
      ],
      generatedAtMs,
      analysisWindowEndExclusiveMs,
      hasOneMinuteCandles: true,
    });
    const oneHour = payload.breakdowns.find((b) => b.timeframe === "1h");
    const btcSlice = oneHour?.slices.find((s) => s.asset === "btc");
    const missingLead = btcSlice?.leads.find((l) => l.leadMinutes === 15);
    expect(missingLead?.sampleCount).toBe(0);
    expect(missingLead?.signedMeanBps).toBeNull();
    expect(missingLead?.absMedianBps).toBeNull();
    expect(missingLead?.thresholdShares).toEqual([null, null, null]);
  });

  it("aggregates the all-assets rollup as sample-weighted across assets", () => {
    const payload = buildLeadTimeDriftPayloadFromAggregateRows({
      rows: [
        aggregateRow({
          asset: "btc",
          timeframe: "1h",
          leadMinutes: 5,
          sampleCount: 100,
          missingCount: 0,
          signedMeanBps: 1,
          absP50Bps: 2,
          absP75Bps: 3,
          absP90Bps: 4,
          absP99Bps: 9,
          withinBpsCounts: [50, 75, 90],
        }),
        aggregateRow({
          asset: "eth",
          timeframe: "1h",
          leadMinutes: 5,
          sampleCount: 300,
          missingCount: 0,
          signedMeanBps: 3,
          absP50Bps: 6,
          absP75Bps: 9,
          absP90Bps: 12,
          absP99Bps: 18,
          withinBpsCounts: [60, 150, 270],
        }),
      ],
      generatedAtMs,
      analysisWindowEndExclusiveMs,
      hasOneMinuteCandles: true,
    });
    const oneHour = payload.breakdowns.find((b) => b.timeframe === "1h");
    const all = oneHour?.slices.find((s) => s.asset === null);
    const lead5 = all?.leads.find((l) => l.leadMinutes === 5);
    expect(lead5?.sampleCount).toBe(400);
    // Weighted mean: (1*100 + 3*300)/400 = 2.5
    expect(lead5?.signedMeanBps).toBeCloseTo(2.5, 5);
    expect(lead5?.absMedianBps).toBeCloseTo(5, 5);
    expect(lead5?.absP75Bps).toBeCloseTo(7.5, 5);
    expect(lead5?.absP90Bps).toBeCloseTo(10, 5);
    expect(lead5?.absP99Bps).toBeCloseTo(15.75, 5);
    // Within-bps counts summed: [110, 225, 360]; shares: /400.
    expect(lead5?.thresholdShares).toEqual([110 / 400, 225 / 400, 360 / 400]);
  });

  it("computes flippedShare per lead and across the all-assets rollup", () => {
    const payload = buildLeadTimeDriftPayloadFromAggregateRows({
      rows: [
        aggregateRow({
          asset: "btc",
          timeframe: "1h",
          leadMinutes: 5,
          sampleCount: 100,
          directionalCount: 100,
          flippedCount: 5,
        }),
        aggregateRow({
          asset: "eth",
          timeframe: "1h",
          leadMinutes: 5,
          sampleCount: 300,
          directionalCount: 300,
          flippedCount: 45,
        }),
      ],
      generatedAtMs,
      analysisWindowEndExclusiveMs,
      hasOneMinuteCandles: true,
    });
    const oneHour = payload.breakdowns.find((b) => b.timeframe === "1h");
    const btcSlice = oneHour?.slices.find((s) => s.asset === "btc");
    const ethSlice = oneHour?.slices.find((s) => s.asset === "eth");
    const all = oneHour?.slices.find((s) => s.asset === null);
    expect(btcSlice?.leads[0]?.flippedShare).toBeCloseTo(0.05, 5);
    expect(ethSlice?.leads[0]?.flippedShare).toBeCloseTo(0.15, 5);
    expect(all?.leads[0]?.directionalCount).toBe(400);
    expect(all?.leads[0]?.flippedShare).toBeCloseTo(50 / 400, 5);
  });

  it("tracks first/last candle ms across all rows", () => {
    const payload = buildLeadTimeDriftPayloadFromAggregateRows({
      rows: [
        aggregateRow({
          asset: "btc",
          timeframe: "1h",
          leadMinutes: 5,
          firstCandleMs: 1_700_000_000_000,
          lastCandleMs: 1_750_000_000_000,
        }),
        aggregateRow({
          asset: "eth",
          timeframe: "1h",
          leadMinutes: 10,
          firstCandleMs: 1_650_000_000_000,
          lastCandleMs: 1_770_000_000_000,
        }),
      ],
      generatedAtMs,
      analysisWindowEndExclusiveMs,
      hasOneMinuteCandles: true,
    });
    expect(payload.firstCandleMs).toBe(1_650_000_000_000);
    expect(payload.lastCandleMs).toBe(1_770_000_000_000);
  });
});
