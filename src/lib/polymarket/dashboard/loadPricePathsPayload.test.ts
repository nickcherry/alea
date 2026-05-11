import {
  buildPricePathsPayloadFromRows,
  type PricePathSampleRow,
} from "@alea/lib/polymarket/dashboard/loadPricePathsPayload";
import { renderPricePathsHtml } from "@alea/lib/polymarket/dashboard/renderPricePathsHtml";
import { describe, expect, it } from "bun:test";

describe("price paths dashboard payload", () => {
  it("aggregates rounded price buckets and 50c band shares", () => {
    const payload = buildPricePathsPayloadFromRows({
      rows: [
        row({
          asset: "btc",
          timeframe: "5m",
          samples: [
            [0, 5_000, 0],
            [60_000, 5_200, 0],
            [240_000, 4_900, 0],
            [295_000, 6_000, 0],
          ],
        }),
      ],
      generatedAtMs: 1_778_517_600_000,
      lookbackDays: 30,
      cutoffMs: 1_775_925_600_000,
    });

    const fiveMinute = payload.breakdowns.find((b) => b.timeframe === "5m");
    const all = fiveMinute?.slices[0];

    expect(payload.sampleCount).toBe(4);
    expect(all?.sampleCount).toBe(4);
    expect(all?.overallWithinOneCentShare).toBe(0.5);
    expect(all?.overallWithinTwoCentShare).toBe(0.75);
    expect(all?.overallWithinFiveCentShare).toBe(0.75);
    expect(all?.heatmap.columns[0]?.counts[50]).toBe(1);
    expect(all?.heatmap.columns[6]?.counts[52]).toBe(1);

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
          timeframe: "5m",
          samples: [
            [0, 5_200, 0],
            [60_000, 5_100, 0],
            [240_000, 4_900, 0],
            [295_000, 6_000, 0],
          ],
        }),
        // Window 2: stays above the whole time, zero crossings.
        row({
          asset: "eth",
          timeframe: "5m",
          samples: [
            [0, 5_500, 0],
            [60_000, 5_400, 0],
            [240_000, 5_300, 0],
            [295_000, 5_200, 0],
          ],
        }),
      ],
      generatedAtMs: 1_778_517_600_000,
      lookbackDays: 30,
      cutoffMs: 1_775_925_600_000,
    });

    const fiveMinute = payload.breakdowns.find((b) => b.timeframe === "5m");
    const all = fiveMinute?.slices[0];
    expect(all?.crossings.totalCrossings).toBe(2);
    expect(all?.crossings.windowsWithAnyCrossing).toBe(1);
    expect(all?.crossings.totalWindows).toBe(2);
    expect(all?.crossings.meanCrossingsPerWindow).toBe(1);
    // Both crossings are in the late half of the window (after the 50%
    // mark), so the early markers should be zero and the late ones >0.
    const fourMinute = all?.crossings.markers.find(
      (m) => m.label === "T-4:00",
    );
    expect(fourMinute?.crossingCount).toBe(0);
    const oneMinute = all?.crossings.markers.find((m) => m.label === "T-1:00");
    // Crossing at offset 240s = T-1:00 bucket (270-240=30s, falls in
    // 240-250 bucket → T-1:00 marker resolves to the same column).
    expect((oneMinute?.crossingCount ?? 0) + (
      all?.crossings.markers.find((m) => m.label === "T-0:30")?.crossingCount ?? 0
    ) + (
      all?.crossings.markers.find((m) => m.label === "T-0:10")?.crossingCount ?? 0
    )).toBeGreaterThanOrEqual(1);

    const btc = fiveMinute?.slices.find((s) => s.asset === "btc");
    expect(btc?.crossings.totalCrossings).toBe(2);
    expect(btc?.crossings.windowsWithAnyCrossing).toBe(1);
    const eth = fiveMinute?.slices.find((s) => s.asset === "eth");
    expect(eth?.crossings.totalCrossings).toBe(0);
    expect(eth?.crossings.windowsWithAnyCrossing).toBe(0);
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
  });
});

function row({
  asset,
  timeframe,
  samples,
}: {
  readonly asset: string;
  readonly timeframe: "5m" | "15m";
  readonly samples: readonly (readonly [number, number, number])[];
}): PricePathSampleRow {
  return {
    asset,
    timeframe,
    window_start_ts_ms: 1_778_517_600_000,
    window_end_ts_ms: 1_778_517_900_000,
    samples,
  };
}
