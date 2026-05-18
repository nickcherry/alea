import {
  enumerateResolutionWindowStarts,
  resolutionTimeframeStepMs,
} from "@alea/lib/polymarket/enumerateWindowStarts";
import { describe, expect, it } from "bun:test";

const ONE_H = resolutionTimeframeStepMs({ timeframe: "1h" });

describe("resolutionTimeframeStepMs", () => {
  it("returns 60 minutes for 1h", () => {
    expect(ONE_H).toBe(60 * 60 * 1000);
  });
});

describe("enumerateResolutionWindowStarts", () => {
  it("walks newest first", () => {
    const start = new Date("2026-05-11T00:00:00Z");
    const end = new Date("2026-05-11T03:00:00Z");
    const ts = enumerateResolutionWindowStarts({
      start,
      end,
      stepMs: ONE_H,
    });
    expect(ts).toEqual([
      Date.parse("2026-05-11T02:00:00Z"),
      Date.parse("2026-05-11T01:00:00Z"),
      Date.parse("2026-05-11T00:00:00Z"),
    ]);
  });

  it("snaps an off-grid end to the previous bar boundary and excludes the in-progress bar", () => {
    // Regression: an unaligned `end` (e.g. new Date()) used to emit
    // off-grid timestamps that produced unresolvable Polymarket slugs.
    // At end=02:18:47, the 02:00 bar is still open, so the newest
    // fully closed bar is 01:00.
    const start = new Date("2026-05-11T00:00:00Z");
    const end = new Date("2026-05-11T02:18:47.123Z");
    const ts = enumerateResolutionWindowStarts({
      start,
      end,
      stepMs: ONE_H,
    });
    expect(ts).toEqual([
      Date.parse("2026-05-11T01:00:00Z"),
      Date.parse("2026-05-11T00:00:00Z"),
    ]);
    for (const value of ts) {
      expect(value % ONE_H).toBe(0);
    }
  });

  it("snaps an off-grid start to the next bar boundary", () => {
    const start = new Date("2026-05-11T00:02:30Z");
    const end = new Date("2026-05-11T03:00:00Z");
    const ts = enumerateResolutionWindowStarts({
      start,
      end,
      stepMs: ONE_H,
    });
    expect(ts[ts.length - 1]).toBe(Date.parse("2026-05-11T01:00:00Z"));
    for (const value of ts) {
      expect(value % ONE_H).toBe(0);
    }
  });

  it("uses the hourly grid for 1h timeframes", () => {
    const start = new Date("2026-05-11T00:00:00Z");
    const end = new Date("2026-05-11T03:00:00Z");
    const ts = enumerateResolutionWindowStarts({
      start,
      end,
      stepMs: ONE_H,
    });
    expect(ts).toEqual([
      Date.parse("2026-05-11T02:00:00Z"),
      Date.parse("2026-05-11T01:00:00Z"),
      Date.parse("2026-05-11T00:00:00Z"),
    ]);
  });

  it("returns an empty list when start >= end", () => {
    expect(
      enumerateResolutionWindowStarts({
        start: new Date("2026-05-11T00:00:00Z"),
        end: new Date("2026-05-11T00:00:00Z"),
        stepMs: ONE_H,
      }),
    ).toEqual([]);
  });
});
