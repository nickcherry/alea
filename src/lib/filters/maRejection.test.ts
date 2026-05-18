import {
  applyMaRejectionLifecycle,
  maRejectionFilter,
} from "@alea/lib/filters/maRejection";
import {
  findRecentMaRejection,
  type MaRejectionBaseConfig,
} from "@alea/lib/filters/maRejectionCore";
import type { ThesisLifecycleConfig } from "@alea/lib/filters/thesisLifecycle";
import type {
  AlignedMarketSeries,
  MarketBar,
} from "@alea/lib/marketSeries/types";
import { describe, expect, it } from "bun:test";

const baseConfig = (
  overrides: Partial<MaRejectionBaseConfig> = {},
): MaRejectionBaseConfig => ({
  fastEmaLength: 5,
  midEmaLength: 10,
  slowEmaLength: 20,
  touchTolerancePct: 0.002,
  minLowerWickPct: 0.2,
  minCloseLocation: 0.6,
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

const buildUptrendWithMaRejection = (): readonly MarketBar[] => {
  const bars: MarketBar[] = [];
  let price = 100;
  for (let i = 0; i < 25; i += 1) {
    const open = price;
    const close = open + 0.8;
    bars.push(
      bar({
        open,
        close,
        high: close + 0.1,
        low: open - 0.05,
        openTimeMs: i,
      }),
    );
    price = close;
  }
  const open = price;
  const close = open + 0.6;
  const low = open - 3.0;
  bars.push(
    bar({
      open,
      close,
      high: close + 0.05,
      low,
      openTimeMs: 25,
    }),
  );
  return bars;
};

describe("findRecentMaRejection", () => {
  it("fires bullish when a long lower wick rejects at the fast EMA in an uptrend", () => {
    const bars = buildUptrendWithMaRejection();
    const match = findRecentMaRejection({ bars, config: baseConfig() });
    expect(match.matched).toBe(true);
    if (match.matched) {
      expect(match.trigger.direction).toBe("up");
    }
  });

  it("returns neutral when the EMA stack is not aligned", () => {
    const bars: MarketBar[] = [];
    let price = 100;
    for (let i = 0; i < 25; i += 1) {
      const open = price;
      const close = i % 2 === 0 ? open + 0.3 : open - 0.3;
      bars.push(
        bar({
          open,
          close,
          high: Math.max(open, close) + 0.05,
          low: Math.min(open, close) - 0.05,
          openTimeMs: i,
        }),
      );
      price = close;
    }
    const match = findRecentMaRejection({ bars, config: baseConfig() });
    expect(match.matched).toBe(false);
  });
});

describe("applyMaRejectionLifecycle", () => {
  it("invalidates when a subsequent close drops back below the fast EMA", () => {
    const bars = [...buildUptrendWithMaRejection()];
    bars.push(
      bar({
        open: bars.at(-1)!.close,
        close: 90,
        high: bars.at(-1)!.close + 0.1,
        low: 89.5,
        openTimeMs: 26,
      }),
    );
    const match = findRecentMaRejection({
      bars,
      config: baseConfig({ maxSignalAgeBars: 5 }),
    });
    if (!match.matched) {
      throw new Error("expected match");
    }
    const evaluation = applyMaRejectionLifecycle({
      match,
      config: lifecycleConfig({ maxConsecutiveWrong: 0 }),
    });
    expect(evaluation.decision).toBe("neutral");
    expect(evaluation.reason).toContain("fast EMA");
  });
});

describe("maRejectionFilter integration", () => {
  it("evaluates through the TradingFilter interface", () => {
    const bars = buildUptrendWithMaRejection();
    const series: AlignedMarketSeries = {
      pyth: bars,
      coinbase: bars.map(() => null),
    };
    const result = maRejectionFilter.evaluate({
      asset: "btc",
      period: "1h",
      targetTsMs: bars.at(-1)!.openTimeMs,
      series,
      config: { ...baseConfig(), ...lifecycleConfig() },
    });
    expect(result.decision).toBe("up");
  });
});
