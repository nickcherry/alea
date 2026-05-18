import {
  applyFailedBreakoutReversalLifecycle,
  failedBreakoutReversalFilter,
} from "@alea/lib/filters/failedBreakoutReversal";
import {
  detectTriggerAt,
  type FailedBreakoutReversalBaseConfig,
  findRecentFailedBreakoutReversal,
} from "@alea/lib/filters/failedBreakoutReversalCore";
import type { ThesisLifecycleConfig } from "@alea/lib/filters/thesisLifecycle";
import type {
  AlignedMarketSeries,
  MarketBar,
} from "@alea/lib/marketSeries/types";
import { describe, expect, it } from "bun:test";

const baseConfig = (
  overrides: Partial<FailedBreakoutReversalBaseConfig> = {},
): FailedBreakoutReversalBaseConfig => ({
  lookbackBars: 5,
  minCloseLocation: 0.6,
  maxSignalAgeBars: 5,
  ...overrides,
});

const lifecycleConfig = (
  overrides: Partial<ThesisLifecycleConfig> = {},
): ThesisLifecycleConfig => ({
  maxAge: 8,
  maxConsecutiveWrong: 2,
  requireWrongLessThanRight: false,
  requireFirstTradeWin: false,
  ...overrides,
});

const bar = ({
  open,
  high,
  low,
  close,
  openTimeMs = 0,
}: {
  open: number;
  high: number;
  low: number;
  close: number;
  openTimeMs?: number;
}): MarketBar => ({
  openTimeMs,
  open,
  high,
  low,
  close,
  volume: 0,
});

const buildBars = (): readonly MarketBar[] => [
  bar({ open: 100, high: 101, low: 99, close: 100, openTimeMs: 1 }),
  bar({ open: 100, high: 102, low: 98, close: 99, openTimeMs: 2 }),
  bar({ open: 99, high: 101, low: 97, close: 100, openTimeMs: 3 }),
  bar({ open: 100, high: 102, low: 98, close: 101, openTimeMs: 4 }),
  bar({ open: 101, high: 102, low: 99, close: 100, openTimeMs: 5 }),
  bar({ open: 100, high: 101, low: 95, close: 100.5, openTimeMs: 6 }),
];

describe("detectTriggerAt", () => {
  it("flags a bullish failed-breakdown reclaim", () => {
    const bars = buildBars();
    const trigger = detectTriggerAt({
      bars,
      index: bars.length - 1,
      config: baseConfig({ lookbackBars: 5, minCloseLocation: 0.6 }),
    });
    expect(trigger).toBeDefined();
    expect(trigger?.direction).toBe("up");
    expect(trigger?.sweepExtreme).toBe(95);
    expect(trigger?.priorBoundary).toBe(97);
  });

  it("flags a bearish failed-breakout rejection", () => {
    const bars: readonly MarketBar[] = [
      bar({ open: 100, high: 101, low: 99, close: 100, openTimeMs: 1 }),
      bar({ open: 100, high: 102, low: 99, close: 100, openTimeMs: 2 }),
      bar({ open: 100, high: 103, low: 99, close: 101, openTimeMs: 3 }),
      bar({ open: 101, high: 102, low: 100, close: 101, openTimeMs: 4 }),
      bar({ open: 101, high: 102, low: 100, close: 101, openTimeMs: 5 }),
      bar({ open: 101, high: 107, low: 100, close: 101, openTimeMs: 6 }),
    ];
    const trigger = detectTriggerAt({
      bars,
      index: bars.length - 1,
      config: baseConfig({ lookbackBars: 5, minCloseLocation: 0.6 }),
    });
    expect(trigger).toBeDefined();
    expect(trigger?.direction).toBe("down");
    expect(trigger?.sweepExtreme).toBe(107);
    expect(trigger?.priorBoundary).toBe(103);
  });

  it("rejects when close-location is weak even if extreme was swept", () => {
    const bars: readonly MarketBar[] = [
      bar({ open: 100, high: 101, low: 99, close: 100, openTimeMs: 1 }),
      bar({ open: 100, high: 102, low: 98, close: 99, openTimeMs: 2 }),
      bar({ open: 99, high: 101, low: 97, close: 100, openTimeMs: 3 }),
      bar({ open: 100, high: 102, low: 98, close: 101, openTimeMs: 4 }),
      bar({ open: 101, high: 102, low: 99, close: 100, openTimeMs: 5 }),
      bar({ open: 100, high: 101, low: 95, close: 97.5, openTimeMs: 6 }),
    ];
    const trigger = detectTriggerAt({
      bars,
      index: bars.length - 1,
      config: baseConfig({ lookbackBars: 5, minCloseLocation: 0.6 }),
    });
    expect(trigger).toBeUndefined();
  });
});

describe("findRecentFailedBreakoutReversal", () => {
  it("returns the most recent trigger inside the recency window", () => {
    const bars = buildBars();
    const match = findRecentFailedBreakoutReversal({
      bars,
      config: baseConfig({ lookbackBars: 5, maxSignalAgeBars: 5 }),
    });
    expect(match.matched).toBe(true);
    if (match.matched) {
      expect(match.trigger.direction).toBe("up");
      expect(match.barsAgo).toBe(0);
    }
  });

  it("returns neutral when no trigger appears in recency window", () => {
    const bars: readonly MarketBar[] = [
      bar({ open: 100, high: 101, low: 99, close: 100, openTimeMs: 1 }),
      bar({ open: 100, high: 101, low: 99, close: 100, openTimeMs: 2 }),
      bar({ open: 100, high: 101, low: 99, close: 100, openTimeMs: 3 }),
      bar({ open: 100, high: 101, low: 99, close: 100, openTimeMs: 4 }),
      bar({ open: 100, high: 101, low: 99, close: 100, openTimeMs: 5 }),
      bar({ open: 100, high: 101, low: 99, close: 100, openTimeMs: 6 }),
    ];
    const match = findRecentFailedBreakoutReversal({
      bars,
      config: baseConfig(),
    });
    expect(match.matched).toBe(false);
    expect(match.evaluation.decision).toBe("neutral");
  });
});

describe("applyFailedBreakoutReversalLifecycle", () => {
  it("keeps decision when lifecycle is not invalidated", () => {
    const bars = buildBars();
    const match = findRecentFailedBreakoutReversal({
      bars,
      config: baseConfig({ maxSignalAgeBars: 0 }),
    });
    expect(match.matched).toBe(true);
    const evaluation = applyFailedBreakoutReversalLifecycle({
      match,
      config: lifecycleConfig(),
    });
    expect(evaluation.decision).toBe("up");
  });

  it("invalidates when subsequent low re-breaks the sweep extreme", () => {
    const bars: readonly MarketBar[] = [
      ...buildBars(),
      bar({ open: 100.5, high: 100.6, low: 94, close: 96, openTimeMs: 7 }),
    ];
    const match = findRecentFailedBreakoutReversal({
      bars,
      config: baseConfig({ maxSignalAgeBars: 5 }),
    });
    expect(match.matched).toBe(true);
    const evaluation = applyFailedBreakoutReversalLifecycle({
      match,
      config: lifecycleConfig({ maxConsecutiveWrong: 0 }),
    });
    expect(evaluation.decision).toBe("neutral");
    expect(evaluation.reason).toContain("re-broke");
  });
});

describe("failedBreakoutReversalFilter integration", () => {
  it("delegates to the core + lifecycle through the TradingFilter interface", () => {
    const bars = buildBars();
    const series: AlignedMarketSeries = {
      pyth: bars,
      coinbase: bars.map(() => null),
    };
    const result = failedBreakoutReversalFilter.evaluate({
      asset: "btc",
      period: "1h",
      targetTsMs: bars.at(-1)!.openTimeMs,
      series,
      config: {
        ...baseConfig(),
        ...lifecycleConfig(),
      },
    });
    expect(result.decision).toBe("up");
  });
});
