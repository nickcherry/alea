import {
  enumerateResolutionWindowStarts,
  resolutionTimeframeStepMs,
} from "@alea/lib/polymarket/enumerateWindowStarts";
import { describe, expect, it } from "bun:test";

const FIVE_M = resolutionTimeframeStepMs({ timeframe: "5m" });
const FIFTEEN_M = resolutionTimeframeStepMs({ timeframe: "15m" });

describe("resolutionTimeframeStepMs", () => {
  it("returns 5 minutes for 5m", () => {
    expect(FIVE_M).toBe(5 * 60 * 1000);
  });
  it("returns 15 minutes for 15m", () => {
    expect(FIFTEEN_M).toBe(15 * 60 * 1000);
  });
});

describe("enumerateResolutionWindowStarts", () => {
  it("walks newest first", () => {
    const start = new Date("2026-05-11T00:00:00Z");
    const end = new Date("2026-05-11T00:30:00Z");
    const ts = enumerateResolutionWindowStarts({
      start,
      end,
      stepMs: FIVE_M,
    });
    // [00:25, 00:20, 00:15, 00:10, 00:05, 00:00]
    expect(ts).toEqual([
      Date.parse("2026-05-11T00:25:00Z"),
      Date.parse("2026-05-11T00:20:00Z"),
      Date.parse("2026-05-11T00:15:00Z"),
      Date.parse("2026-05-11T00:10:00Z"),
      Date.parse("2026-05-11T00:05:00Z"),
      Date.parse("2026-05-11T00:00:00Z"),
    ]);
  });

  it("snaps an off-grid end to the previous bar boundary and excludes the in-progress bar", () => {
    // Regression: an unaligned `end` (e.g. new Date()) used to emit
    // off-grid timestamps that produced unresolvable Polymarket slugs.
    // At end=00:18:47, the 00:15 bar is still open (closes 00:20), so
    // the newest fully-closed bar is 00:10.
    const start = new Date("2026-05-11T00:00:00Z");
    const end = new Date("2026-05-11T00:18:47.123Z");
    const ts = enumerateResolutionWindowStarts({
      start,
      end,
      stepMs: FIVE_M,
    });
    expect(ts).toEqual([
      Date.parse("2026-05-11T00:10:00Z"),
      Date.parse("2026-05-11T00:05:00Z"),
      Date.parse("2026-05-11T00:00:00Z"),
    ]);
    for (const value of ts) {
      expect(value % FIVE_M).toBe(0);
    }
  });

  it("snaps an off-grid start to the next bar boundary", () => {
    const start = new Date("2026-05-11T00:02:30Z");
    const end = new Date("2026-05-11T00:30:00Z");
    const ts = enumerateResolutionWindowStarts({
      start,
      end,
      stepMs: FIVE_M,
    });
    expect(ts[ts.length - 1]).toBe(Date.parse("2026-05-11T00:05:00Z"));
    for (const value of ts) {
      expect(value % FIVE_M).toBe(0);
    }
  });

  it("uses the 15m grid for 15m timeframes", () => {
    const start = new Date("2026-05-11T00:00:00Z");
    const end = new Date("2026-05-11T01:00:00Z");
    const ts = enumerateResolutionWindowStarts({
      start,
      end,
      stepMs: FIFTEEN_M,
    });
    expect(ts).toEqual([
      Date.parse("2026-05-11T00:45:00Z"),
      Date.parse("2026-05-11T00:30:00Z"),
      Date.parse("2026-05-11T00:15:00Z"),
      Date.parse("2026-05-11T00:00:00Z"),
    ]);
  });

  it("returns an empty list when start >= end", () => {
    expect(
      enumerateResolutionWindowStarts({
        start: new Date("2026-05-11T00:00:00Z"),
        end: new Date("2026-05-11T00:00:00Z"),
        stepMs: FIVE_M,
      }),
    ).toEqual([]);
  });
});
