import {
  aggregate5mTo15m,
  map5mToClosed15mIndex,
} from "@alea/lib/training/regimeAlgos/rsiDivergence/aggregateTo15m";
import type { DivergenceBar } from "@alea/lib/training/regimeAlgos/rsiDivergence/computeDivergence";
import { describe, expect, it } from "bun:test";

const FIVE_MIN_MS = 5 * 60 * 1000;
const FIFTEEN_MIN_MS = 15 * 60 * 1000;

function bar({
  openTimeMs,
  high,
  low,
  close,
}: {
  openTimeMs: number;
  high: number;
  low: number;
  close: number;
}): DivergenceBar {
  return { openTimeMs, high, low, close };
}

describe("aggregate5mTo15m", () => {
  it("returns empty for empty input", () => {
    expect(aggregate5mTo15m({ bars: [] })).toEqual([]);
  });

  it("groups every 3 contiguous 5m bars on a 15m boundary", () => {
    // Start at midnight 2026-01-01 — clean 15m boundary.
    const t0 = Date.UTC(2026, 0, 1);
    const bars: DivergenceBar[] = [
      bar({ openTimeMs: t0 + 0 * FIVE_MIN_MS, high: 110, low: 100, close: 105 }),
      bar({ openTimeMs: t0 + 1 * FIVE_MIN_MS, high: 108, low: 102, close: 106 }),
      bar({ openTimeMs: t0 + 2 * FIVE_MIN_MS, high: 112, low: 104, close: 109 }),
    ];
    const out = aggregate5mTo15m({ bars });
    expect(out).toEqual([
      { openTimeMs: t0, high: 112, low: 100, close: 109 },
    ]);
  });

  it("emits one 15m bar per complete group across multiple groups", () => {
    const t0 = Date.UTC(2026, 0, 1);
    const bars: DivergenceBar[] = [];
    for (let i = 0; i < 9; i += 1) {
      bars.push(
        bar({
          openTimeMs: t0 + i * FIVE_MIN_MS,
          high: 100 + i,
          low: 100 - i,
          close: 100 + i,
        }),
      );
    }
    const out = aggregate5mTo15m({ bars });
    expect(out).toHaveLength(3);
    expect(out[0]!.openTimeMs).toBe(t0);
    expect(out[1]!.openTimeMs).toBe(t0 + FIFTEEN_MIN_MS);
    expect(out[2]!.openTimeMs).toBe(t0 + 2 * FIFTEEN_MIN_MS);
    // First group: highs 100,101,102 → max 102; lows 100,99,98 → min 98.
    expect(out[0]).toEqual({
      openTimeMs: t0,
      high: 102,
      low: 98,
      close: 102,
    });
  });

  it("drops a partial trailing group", () => {
    const t0 = Date.UTC(2026, 0, 1);
    const bars: DivergenceBar[] = [];
    for (let i = 0; i < 5; i += 1) {
      bars.push(
        bar({
          openTimeMs: t0 + i * FIVE_MIN_MS,
          high: 100,
          low: 100,
          close: 100,
        }),
      );
    }
    const out = aggregate5mTo15m({ bars });
    expect(out).toHaveLength(1); // Only the first complete 3-bar group.
  });

  it("skips a group with a gap rather than emitting a degenerate bar", () => {
    const t0 = Date.UTC(2026, 0, 1);
    const bars: DivergenceBar[] = [
      bar({ openTimeMs: t0, high: 100, low: 100, close: 100 }),
      // Skip 5-10 minute slot.
      bar({
        openTimeMs: t0 + 2 * FIVE_MIN_MS,
        high: 100,
        low: 100,
        close: 100,
      }),
      bar({
        openTimeMs: t0 + 3 * FIVE_MIN_MS,
        high: 100,
        low: 100,
        close: 100,
      }),
    ];
    const out = aggregate5mTo15m({ bars });
    expect(out).toHaveLength(0);
  });

  it("ignores bars not aligned to a 15m boundary", () => {
    const t0 = Date.UTC(2026, 0, 1) + 5 * 60 * 1000; // 00:05 UTC
    const bars: DivergenceBar[] = [
      bar({ openTimeMs: t0, high: 100, low: 100, close: 100 }),
      bar({
        openTimeMs: t0 + FIVE_MIN_MS,
        high: 100,
        low: 100,
        close: 100,
      }),
      bar({
        openTimeMs: t0 + 2 * FIVE_MIN_MS,
        high: 100,
        low: 100,
        close: 100,
      }),
    ];
    // First bar starts at 00:05, NOT on a 15m boundary; aggregator
    // walks past it. With only 3 bars total, no complete group at a
    // boundary is found.
    const out = aggregate5mTo15m({ bars });
    expect(out).toHaveLength(0);
  });
});

describe("map5mToClosed15mIndex", () => {
  it("maps every 5m bar to the most recent closed 15m index", () => {
    const t0 = Date.UTC(2026, 0, 1);
    // 9 5m bars covering 3 15m windows.
    const bars5m: DivergenceBar[] = [];
    for (let i = 0; i < 9; i += 1) {
      bars5m.push(
        bar({
          openTimeMs: t0 + i * FIVE_MIN_MS,
          high: 100,
          low: 100,
          close: 100,
        }),
      );
    }
    const bars15m = aggregate5mTo15m({ bars: bars5m });
    expect(bars15m).toHaveLength(3);

    const map = map5mToClosed15mIndex({ bars5m, bars15m });
    expect(map).toHaveLength(9);
    // Bars 0,1: 15m bar at t0 not yet closed (closes at t0+15m, equal
    // to the close of bar 2). So bars 0,1 see no closed 15m.
    expect(map[0]).toBe(null);
    expect(map[1]).toBe(null);
    // Bar 2: closes at t0+15m, the first 15m bar's close exactly. So
    // index 0 is now closed.
    expect(map[2]).toBe(0);
    // Bar 3: closes at t0+20m, still only the first 15m bar is closed.
    expect(map[3]).toBe(0);
    expect(map[4]).toBe(0);
    expect(map[5]).toBe(1); // Second 15m bar closes at t0+30m.
    expect(map[8]).toBe(2);
  });

  it("returns nulls when no 15m bars are closed yet", () => {
    const t0 = Date.UTC(2026, 0, 1);
    const bars5m: DivergenceBar[] = [
      bar({ openTimeMs: t0, high: 100, low: 100, close: 100 }),
      bar({ openTimeMs: t0 + FIVE_MIN_MS, high: 100, low: 100, close: 100 }),
    ];
    const map = map5mToClosed15mIndex({ bars5m, bars15m: [] });
    expect(map).toEqual([null, null]);
  });
});
