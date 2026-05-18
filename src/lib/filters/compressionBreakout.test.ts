import {
  applyCompressionBreakoutLifecycle,
  compressionBreakoutFilter,
} from "@alea/lib/filters/compressionBreakout";
import {
  type CompressionBreakoutBaseConfig,
  findRecentCompressionBreakout,
} from "@alea/lib/filters/compressionBreakoutCore";
import type { ThesisLifecycleConfig } from "@alea/lib/filters/thesisLifecycle";
import type {
  AlignedMarketSeries,
  MarketBar,
} from "@alea/lib/marketSeries/types";
import { describe, expect, it } from "bun:test";

const baseConfig = (
  overrides: Partial<CompressionBreakoutBaseConfig> = {},
): CompressionBreakoutBaseConfig => ({
  tightWindow: 5,
  baselineWindow: 15,
  maxTightRatio: 0.6,
  minBodyPct: 0.4,
  minCloseLocation: 0.65,
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

const wideBar = (open: number, idx: number): MarketBar =>
  bar({
    open,
    high: open + 2,
    low: open - 2,
    close: open + (idx % 2 === 0 ? 1 : -1),
    openTimeMs: idx,
  });

const tightBar = (open: number, idx: number): MarketBar =>
  bar({
    open,
    high: open + 0.3,
    low: open - 0.3,
    close: open + (idx % 2 === 0 ? 0.1 : -0.1),
    openTimeMs: idx,
  });

const buildCompressionBars = (): readonly MarketBar[] => {
  const bars: MarketBar[] = [];
  for (let i = 0; i < 15; i += 1) {
    bars.push(wideBar(100, i));
  }
  for (let i = 0; i < 5; i += 1) {
    bars.push(tightBar(100, 15 + i));
  }
  bars.push(
    bar({
      open: 100,
      high: 102.5,
      low: 99.9,
      close: 102.3,
      openTimeMs: 20,
    }),
  );
  return bars;
};

describe("findRecentCompressionBreakout", () => {
  it("fires bullish when current bar breaks out of compression with strong close", () => {
    const bars = buildCompressionBars();
    const match = findRecentCompressionBreakout({
      bars,
      config: baseConfig(),
    });
    expect(match.matched).toBe(true);
    if (match.matched) {
      expect(match.trigger.direction).toBe("up");
      expect(match.trigger.compressionHigh).toBeGreaterThan(99.9);
    }
  });

  it("returns neutral when compression criteria not satisfied", () => {
    const bars: MarketBar[] = [];
    for (let i = 0; i < 25; i += 1) {
      bars.push(wideBar(100, i));
    }
    const match = findRecentCompressionBreakout({
      bars,
      config: baseConfig(),
    });
    expect(match.matched).toBe(false);
  });
});

describe("applyCompressionBreakoutLifecycle", () => {
  it("invalidates when subsequent close drops back inside compression", () => {
    const bars = [...buildCompressionBars()];
    bars.push(
      bar({
        open: 102.3,
        high: 102.5,
        low: 99.95,
        close: 100.1,
        openTimeMs: 21,
      }),
    );
    const match = findRecentCompressionBreakout({
      bars,
      config: baseConfig({ maxSignalAgeBars: 5 }),
    });
    if (!match.matched) {
      throw new Error("expected match");
    }
    const evaluation = applyCompressionBreakoutLifecycle({
      match,
      config: lifecycleConfig({ maxConsecutiveWrong: 0 }),
    });
    expect(evaluation.decision).toBe("neutral");
    expect(evaluation.reason).toContain("compression");
  });
});

describe("compressionBreakoutFilter integration", () => {
  it("evaluates through the TradingFilter interface", () => {
    const bars = buildCompressionBars();
    const series: AlignedMarketSeries = {
      pyth: bars,
      coinbase: bars.map(() => null),
    };
    const result = compressionBreakoutFilter.evaluate({
      asset: "btc",
      period: "1h",
      targetTsMs: bars.at(-1)!.openTimeMs,
      series,
      config: { ...baseConfig(), ...lifecycleConfig() },
    });
    expect(result.decision).toBe("up");
  });
});
