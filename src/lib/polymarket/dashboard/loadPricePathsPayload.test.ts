import {
  buildPricePathsPayloadFromRows,
  type PricePathSampleRow,
} from "@alea/lib/polymarket/dashboard/loadPricePathsPayload";
import { renderPricePathsHtml } from "@alea/lib/polymarket/dashboard/renderPricePathsHtml";
import { encodePriceSamples } from "@alea/lib/polymarket/priceSampleCodec";
import { describe, expect, it } from "bun:test";

describe("price paths dashboard payload", () => {
  it("aggregates rounded price buckets and 50c band shares", () => {
    const payload = buildPricePathsPayloadFromRows({
      rows: [
        row({
          asset: "btc",
          timeframe: "1h",
          samples: [
            [0, 5_000],
            [60_000, 5_200],
            [240_000, 4_900],
            [295_000, 6_000],
            [3_540_000, 5_000],
          ],
        }),
      ],
      generatedAtMs: 1_778_517_600_000,
      lookbackDays: 30,
      cutoffMs: 1_775_925_600_000,
    });

    const oneHour = payload.breakdowns.find((b) => b.timeframe === "1h");
    const all = oneHour?.slices[0];

    expect(payload.sampleCount).toBe(5);
    expect(all?.sampleCount).toBe(5);
    expect(all?.overallWithinOneCentShare).toBe(0.6);
    expect(all?.overallWithinTwoCentShare).toBe(0.8);
    expect(all?.overallWithinFiveCentShare).toBe(0.8);
    // Leftmost columns are pre-market buckets; the first
    // intra-market column lands at index 360.
    expect(all?.heatmap.columns[360]?.counts[50]).toBe(1);
    expect(all?.heatmap.columns[366]?.counts[52]).toBe(1);

    const oneMinuteMarker = all?.markerShares.find((m) => m.label === "T-1:00");
    expect(oneMinuteMarker?.withinOneCentShare).toBe(1);
  });

  it("counts 50c crossings per window and buckets them by time remaining", () => {
    const payload = buildPricePathsPayloadFromRows({
      rows: [
        // Window 1: starts above (52), drops below (49) at offset 240s,
        // then climbs back above (60) at offset 295s. Two crossings, both
        // in late buckets.
        row({
          asset: "btc",
          timeframe: "1h",
          samples: [
            [0, 5_200],
            [60_000, 5_100],
            [240_000, 4_900],
            [295_000, 6_000],
          ],
        }),
        // Window 2: stays above the whole time, zero crossings.
        row({
          asset: "eth",
          timeframe: "1h",
          samples: [
            [0, 5_500],
            [60_000, 5_400],
            [240_000, 5_300],
            [295_000, 5_200],
          ],
        }),
      ],
      generatedAtMs: 1_778_517_600_000,
      lookbackDays: 30,
      cutoffMs: 1_775_925_600_000,
    });

    const oneHour = payload.breakdowns.find((b) => b.timeframe === "1h");
    const all = oneHour?.slices[0];
    expect(all?.crossings.totalCrossings).toBe(2);
    expect(all?.crossings.windowsWithAnyCrossing).toBe(1);
    expect(all?.crossings.totalWindows).toBe(2);
    expect(all?.crossings.meanCrossingsPerWindow).toBe(1);
    // 1h candle plus 1h pre-market lead, at 10s buckets, yields 720 buckets.
    expect(all?.crossings.buckets.length).toBe(720);
    const bucketedCrossings = (all?.crossings.buckets ?? []).reduce(
      (sum, b) => sum + b.crossingCount,
      0,
    );
    expect(bucketedCrossings).toBe(2);

    const btc = oneHour?.slices.find((s) => s.asset === "btc");
    expect(btc?.crossings.totalCrossings).toBe(2);
    expect(btc?.crossings.windowsWithAnyCrossing).toBe(1);
    const eth = oneHour?.slices.find((s) => s.asset === "eth");
    expect(eth?.crossings.totalCrossings).toBe(0);
    expect(eth?.crossings.windowsWithAnyCrossing).toBe(0);
  });

  it("falls back to DOWN-side mid when UP is missing", () => {
    const payload = buildPricePathsPayloadFromRows({
      rows: [
        {
          asset: "btc",
          timeframe: "1h",
          window_start_ts_ms: 1_778_517_600_000,
          window_end_ts_ms: 1_778_521_200_000,
          samples: encodePriceSamples([
            { offsetMs: 0, upBps: null, downBps: 4_800 },
            { offsetMs: 60_000, upBps: 5_300, downBps: 4_700 },
          ]),
        },
      ],
      generatedAtMs: 1_778_517_600_000,
      lookbackDays: 30,
      cutoffMs: 1_775_925_600_000,
    });

    const oneHour = payload.breakdowns.find((b) => b.timeframe === "1h");
    const all = oneHour?.slices[0];
    expect(all?.sampleCount).toBe(2);
    // First tick is reconstructed as 10000 - 4800 = 5200 → bucket 52.
    // 360 pre-market columns sit to the left, so intra-market column 0 → 360.
    expect(all?.heatmap.columns[360]?.counts[52]).toBe(1);
    expect(all?.heatmap.columns[366]?.counts[53]).toBe(1);
  });

  it("places pre-market negative-offset ticks in left-side columns", () => {
    const payload = buildPricePathsPayloadFromRows({
      rows: [
        {
          asset: "btc",
          timeframe: "1h",
          window_start_ts_ms: 1_778_517_600_000,
          window_end_ts_ms: 1_778_521_200_000,
          samples: encodePriceSamples([
            { offsetMs: -3_600_000, upBps: 5_000, downBps: 5_000 },
            { offsetMs: -1_000, upBps: 5_100, downBps: 4_900 },
            { offsetMs: 0, upBps: 5_050, downBps: 4_950 },
            { offsetMs: 240_000, upBps: 5_300, downBps: 4_700 },
          ]),
        },
      ],
      generatedAtMs: 1_778_517_600_000,
      lookbackDays: 30,
      cutoffMs: 1_775_925_600_000,
    });

    const oneHour = payload.breakdowns.find((b) => b.timeframe === "1h");
    const all = oneHour?.slices[0];
    expect(all?.sampleCount).toBe(4);
    // Leftmost column holds the tick from one hour before market open.
    expect(all?.heatmap.columns[0]?.counts[50]).toBe(1);
    // Column 359 sits just before the open boundary; the −1000 ms tick
    // lands there at 51c.
    expect(all?.heatmap.columns[359]?.counts[51]).toBe(1);
    // Column 360 is the first intra-market column; offsetMs=0 tick at 51c.
    expect(all?.heatmap.columns[360]?.counts[51]).toBe(1);

    const labels = (all?.markerShares ?? []).map((m) => m.label);
    expect(labels).toContain("T-120:00");
    expect(labels).toContain("T-90:00");
    expect(labels).toContain("T-75:00");
    expect(labels).toContain("T-70:00");
    expect(labels).toContain("T-65:00");
    expect(labels).toContain("T-63:00");
    expect(labels).toContain("T-61:00");
  });

  it("renders the price-path route and empty state", () => {
    const payload = buildPricePathsPayloadFromRows({
      rows: [],
      generatedAtMs: 1_778_517_600_000,
      lookbackDays: 30,
      cutoffMs: 1_775_925_600_000,
    });

    const html = renderPricePathsHtml({
      payload,
      assets: { stylesheets: [], scripts: [] },
    });

    expect(html).toContain("Price Paths");
    expect(html).toContain('href="/price-paths/" aria-current="page"');
    expect(html).toContain("bun alea polymarket:price-sample");
    expect(html).toContain('"sampleCount":0');
    expect(html).not.toContain("price-path-period-tab");
  });
});

function row({
  asset,
  timeframe,
  samples,
}: {
  readonly asset: string;
  readonly timeframe: "1h";
  readonly samples: readonly (readonly [number, number])[];
}): PricePathSampleRow {
  return {
    asset,
    timeframe,
    window_start_ts_ms: 1_778_517_600_000,
    window_end_ts_ms: 1_778_521_200_000,
    samples: encodePriceSamples(
      samples.map(([offsetMs, upBps]) => ({
        offsetMs,
        upBps,
        downBps: 10_000 - upBps,
      })),
    ),
  };
}
