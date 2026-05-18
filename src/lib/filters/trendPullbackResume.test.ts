import type { ThesisLifecycleConfig } from "@alea/lib/filters/thesisLifecycle";
import {
  applyTrendPullbackResumeLifecycle,
  trendPullbackResumeFilter,
} from "@alea/lib/filters/trendPullbackResume";
import {
  findRecentTrendPullbackResume,
  type TrendPullbackResumeBaseConfig,
} from "@alea/lib/filters/trendPullbackResumeCore";
import type {
  AlignedMarketSeries,
  MarketBar,
} from "@alea/lib/marketSeries/types";
import { describe, expect, it } from "bun:test";

const baseConfig = (
  overrides: Partial<TrendPullbackResumeBaseConfig> = {},
): TrendPullbackResumeBaseConfig => ({
  fastEmaLength: 5,
  slowEmaLength: 10,
  slopeLookback: 1,
  pullbackWindow: 3,
  minBodyPct: 0.4,
  minCloseLocation: 0.6,
  maxSignalAgeBars: 2,
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

const buildBullishBars = (): readonly MarketBar[] => {
  const bars: MarketBar[] = [];
  let price = 100;
  for (let i = 0; i < 18; i += 1) {
    const open = price;
    const close = open + 1;
    bars.push(
      bar({
        open,
        close,
        high: close + 0.2,
        low: open - 0.2,
        openTimeMs: i,
      }),
    );
    price = close;
  }
  for (let i = 0; i < 2; i += 1) {
    const open = price;
    const close = open - 0.5;
    bars.push(
      bar({
        open,
        close,
        high: open + 0.1,
        low: close - 0.1,
        openTimeMs: 18 + i,
      }),
    );
    price = close;
  }
  const open = price;
  const close = open + 1.8;
  bars.push(
    bar({
      open,
      close,
      high: close + 0.05,
      low: open - 0.05,
      openTimeMs: 20,
    }),
  );
  return bars;
};

describe("findRecentTrendPullbackResume", () => {
  it("returns a bullish trigger when uptrend pulls back and resumes", () => {
    const bars = buildBullishBars();
    const match = findRecentTrendPullbackResume({
      bars,
      config: baseConfig(),
    });
    expect(match.matched).toBe(true);
    if (match.matched) {
      expect(match.trigger.direction).toBe("up");
      expect(match.trigger.pullbackCount).toBeGreaterThan(0);
    }
  });

  it("returns neutral when the pullback breaks below the slow EMA", () => {
    const bars: MarketBar[] = [];
    let price = 100;
    for (let i = 0; i < 18; i += 1) {
      const open = price;
      const close = open + 1;
      bars.push(
        bar({
          open,
          close,
          high: close + 0.2,
          low: open - 0.2,
          openTimeMs: i,
        }),
      );
      price = close;
    }
    for (let i = 0; i < 3; i += 1) {
      const open = price;
      const close = open - 4;
      bars.push(
        bar({
          open,
          close,
          high: open + 0.1,
          low: close - 0.1,
          openTimeMs: 18 + i,
        }),
      );
      price = close;
    }
    const open = price;
    const close = open + 1.8;
    bars.push(
      bar({
        open,
        close,
        high: close + 0.05,
        low: open - 0.05,
        openTimeMs: 21,
      }),
    );
    const match = findRecentTrendPullbackResume({
      bars,
      config: baseConfig(),
    });
    expect(match.matched).toBe(false);
  });
});

describe("applyTrendPullbackResumeLifecycle", () => {
  it("invalidates when a subsequent bar closes back below slow EMA", () => {
    const bars = [...buildBullishBars()];
    const lastClose = bars.at(-1)!.close;
    bars.push(
      bar({
        open: lastClose,
        close: lastClose - 30,
        high: lastClose + 0.1,
        low: lastClose - 30,
        openTimeMs: 21,
      }),
    );
    const match = findRecentTrendPullbackResume({
      bars,
      config: baseConfig(),
    });
    if (!match.matched) {
      throw new Error("expected match");
    }
    const evaluation = applyTrendPullbackResumeLifecycle({
      match,
      config: lifecycleConfig({ maxConsecutiveWrong: 0 }),
    });
    expect(evaluation.decision).toBe("neutral");
    expect(evaluation.reason).toContain("slow EMA");
  });
});

describe("trendPullbackResumeFilter integration", () => {
  it("evaluates through the TradingFilter interface", () => {
    const bars = buildBullishBars();
    const series: AlignedMarketSeries = {
      pyth: bars,
      coinbase: bars.map(() => null),
    };
    const result = trendPullbackResumeFilter.evaluate({
      asset: "btc",
      period: "1h",
      targetTsMs: bars.at(-1)!.openTimeMs,
      series,
      config: { ...baseConfig(), ...lifecycleConfig() },
    });
    expect(result.decision).toBe("up");
  });
});
