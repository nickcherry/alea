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
    expect(payload.breakdowns).toHaveLength(2);
    for (const breakdown of payload.breakdowns) {
      expect(breakdown.slices).toHaveLength(0);
    }
  });

  it("organises 5m and 15m breakdowns with all-assets rollup first", () => {
    const payload = buildLeadTimeDriftPayloadFromAggregateRows({
      rows: [
        aggregateRow({ asset: "btc", timeframe: "5m", leadMinutes: 1 }),
        aggregateRow({ asset: "btc", timeframe: "5m", leadMinutes: 2 }),
        aggregateRow({ asset: "eth", timeframe: "5m", leadMinutes: 1 }),
        aggregateRow({ asset: "btc", timeframe: "15m", leadMinutes: 3 }),
      ],
      generatedAtMs,
      analysisWindowEndExclusiveMs,
      hasOneMinuteCandles: true,
    });

    const fiveMinute = payload.breakdowns.find((b) => b.timeframe === "5m");
    expect(fiveMinute?.leadMinutes).toEqual([1, 2, 3, 4]);
    expect(fiveMinute?.slices[0]?.asset).toBeNull();
    expect(fiveMinute?.slices[0]?.label).toBe("All assets");
    // Per-asset slices follow.
    const btcSlice = fiveMinute?.slices.find((s) => s.asset === "btc");
    expect(btcSlice?.label).toBe("BTC");
    const ethSlice = fiveMinute?.slices.find((s) => s.asset === "eth");
    expect(ethSlice?.label).toBe("ETH");
  });

  it("derives threshold shares from the per-row within counts", () => {
    const payload = buildLeadTimeDriftPayloadFromAggregateRows({
      rows: [
        aggregateRow({
          asset: "btc",
          timeframe: "5m",
          leadMinutes: 1,
          sampleCount: 200,
          withinBpsCounts: [100, 150, 190],
        }),
      ],
      generatedAtMs,
      analysisWindowEndExclusiveMs,
      hasOneMinuteCandles: true,
    });
    const fiveMinute = payload.breakdowns.find((b) => b.timeframe === "5m");
    const btcSlice = fiveMinute?.slices.find((s) => s.asset === "btc");
    const lead1 = btcSlice?.leads.find((l) => l.leadMinutes === 1);
    expect(lead1?.thresholdShares).toEqual([0.5, 0.75, 0.95]);
  });

  it("returns null shares and percentiles when a lead has no samples", () => {
    const payload = buildLeadTimeDriftPayloadFromAggregateRows({
      rows: [
        aggregateRow({
          asset: "btc",
          timeframe: "5m",
          leadMinutes: 1,
        }),
      ],
      generatedAtMs,
      analysisWindowEndExclusiveMs,
      hasOneMinuteCandles: true,
    });
    const fiveMinute = payload.breakdowns.find((b) => b.timeframe === "5m");
    const btcSlice = fiveMinute?.slices.find((s) => s.asset === "btc");
    const missingLead = btcSlice?.leads.find((l) => l.leadMinutes === 3);
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
          timeframe: "5m",
          leadMinutes: 1,
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
          timeframe: "5m",
          leadMinutes: 1,
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
    const fiveMinute = payload.breakdowns.find((b) => b.timeframe === "5m");
    const all = fiveMinute?.slices.find((s) => s.asset === null);
    const lead1 = all?.leads.find((l) => l.leadMinutes === 1);
    expect(lead1?.sampleCount).toBe(400);
    // Weighted mean: (1*100 + 3*300)/400 = 2.5
    expect(lead1?.signedMeanBps).toBeCloseTo(2.5, 5);
    expect(lead1?.absMedianBps).toBeCloseTo(5, 5);
    expect(lead1?.absP75Bps).toBeCloseTo(7.5, 5);
    expect(lead1?.absP90Bps).toBeCloseTo(10, 5);
    expect(lead1?.absP99Bps).toBeCloseTo(15.75, 5);
    // Within-bps counts summed: [110, 225, 360]; shares: /400.
    expect(lead1?.thresholdShares).toEqual([110 / 400, 225 / 400, 360 / 400]);
  });

  it("computes flippedShare per lead and across the all-assets rollup", () => {
    const payload = buildLeadTimeDriftPayloadFromAggregateRows({
      rows: [
        aggregateRow({
          asset: "btc",
          timeframe: "5m",
          leadMinutes: 1,
          sampleCount: 100,
          directionalCount: 100,
          flippedCount: 5,
        }),
        aggregateRow({
          asset: "eth",
          timeframe: "5m",
          leadMinutes: 1,
          sampleCount: 300,
          directionalCount: 300,
          flippedCount: 45,
        }),
      ],
      generatedAtMs,
      analysisWindowEndExclusiveMs,
      hasOneMinuteCandles: true,
    });
    const fiveMinute = payload.breakdowns.find((b) => b.timeframe === "5m");
    const btcSlice = fiveMinute?.slices.find((s) => s.asset === "btc");
    const ethSlice = fiveMinute?.slices.find((s) => s.asset === "eth");
    const all = fiveMinute?.slices.find((s) => s.asset === null);
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
          timeframe: "5m",
          leadMinutes: 1,
          firstCandleMs: 1_700_000_000_000,
          lastCandleMs: 1_750_000_000_000,
        }),
        aggregateRow({
          asset: "eth",
          timeframe: "15m",
          leadMinutes: 1,
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
