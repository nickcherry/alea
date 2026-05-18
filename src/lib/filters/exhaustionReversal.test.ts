import {
  applyExhaustionReversalLifecycle,
  exhaustionReversalFilter,
} from "@alea/lib/filters/exhaustionReversal";
import {
  type ExhaustionReversalBaseConfig,
  findRecentExhaustionReversal,
} from "@alea/lib/filters/exhaustionReversalCore";
import type { ThesisLifecycleConfig } from "@alea/lib/filters/thesisLifecycle";
import type {
  AlignedMarketSeries,
  MarketBar,
} from "@alea/lib/marketSeries/types";
import { describe, expect, it } from "bun:test";

const baseConfig = (
  overrides: Partial<ExhaustionReversalBaseConfig> = {},
): ExhaustionReversalBaseConfig => ({
  emaLength: 5,
  runWindow: 5,
  minDirectionalCount: 4,
  minRunReturnPct: 0.005,
  minDistanceFromEmaPct: 0.001,
  minWickPct: 0.1,
  maxCloseLocation: 0.45,
  requireBodyShrink: false,
  maxSignalAgeBars: 0,
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

const buildExhaustionBars = (): readonly MarketBar[] => {
  const bars: MarketBar[] = [];
  let price = 100;
  for (let i = 0; i < 15; i += 1) {
    const open = price;
    const close = open + 0.8;
    bars.push(
      bar({
        open,
        close,
        high: close + 0.1,
        low: open - 0.1,
        openTimeMs: i,
      }),
    );
    price = close;
  }
  const exhaustionOpen = price;
  bars.push(
    bar({
      open: exhaustionOpen,
      high: exhaustionOpen + 0.6,
      low: exhaustionOpen - 0.2,
      close: exhaustionOpen + 0.05,
      openTimeMs: 15,
    }),
  );
  return bars;
};

describe("findRecentExhaustionReversal", () => {
  it("fires bearish after a sustained run with an upper-wick weak close", () => {
    const bars = buildExhaustionBars();
    const match = findRecentExhaustionReversal({
      bars,
      config: baseConfig(),
    });
    expect(match.matched).toBe(true);
    if (match.matched) {
      expect(match.trigger.direction).toBe("down");
      expect(match.trigger.runDirectionCount).toBeGreaterThanOrEqual(4);
      expect(match.trigger.exhaustionExtreme).toBeGreaterThan(0);
    }
  });

  it("returns neutral if there was no strong directional run", () => {
    const bars: MarketBar[] = [];
    let price = 100;
    for (let i = 0; i < 15; i += 1) {
      const open = price;
      const close = i % 2 === 0 ? open + 0.3 : open - 0.3;
      bars.push(
        bar({
          open,
          close,
          high: Math.max(open, close) + 0.1,
          low: Math.min(open, close) - 0.1,
          openTimeMs: i,
        }),
      );
      price = close;
    }
    const exhaustionOpen = price;
    bars.push(
      bar({
        open: exhaustionOpen,
        high: exhaustionOpen + 0.6,
        low: exhaustionOpen - 0.2,
        close: exhaustionOpen + 0.05,
        openTimeMs: 15,
      }),
    );
    const match = findRecentExhaustionReversal({
      bars,
      config: baseConfig(),
    });
    expect(match.matched).toBe(false);
  });
});

describe("applyExhaustionReversalLifecycle", () => {
  it("invalidates when a subsequent close exceeds the exhaustion high", () => {
    const bars = [...buildExhaustionBars()];
    const lastBar = bars.at(-1)!;
    bars.push(
      bar({
        open: lastBar.close,
        close: lastBar.high + 1,
        high: lastBar.high + 1.1,
        low: lastBar.close - 0.05,
        openTimeMs: 16,
      }),
    );
    const match = findRecentExhaustionReversal({
      bars,
      config: baseConfig({ maxSignalAgeBars: 5 }),
    });
    if (!match.matched) {
      throw new Error("expected match");
    }
    const evaluation = applyExhaustionReversalLifecycle({
      match,
      config: lifecycleConfig({ maxConsecutiveWrong: 0 }),
    });
    expect(evaluation.decision).toBe("neutral");
    expect(evaluation.reason).toContain("exhaustion");
  });
});

describe("exhaustionReversalFilter integration", () => {
  it("evaluates through the TradingFilter interface", () => {
    const bars = buildExhaustionBars();
    const series: AlignedMarketSeries = {
      pyth: bars,
      coinbase: bars.map(() => null),
    };
    const result = exhaustionReversalFilter.evaluate({
      asset: "btc",
      period: "1h",
      targetTsMs: bars.at(-1)!.openTimeMs,
      series,
      config: { ...baseConfig(), ...lifecycleConfig() },
    });
    expect(result.decision).toBe("down");
  });
});
