import {
  type RangeBreakoutFadeConfig,
  rangeBreakoutFadeFilter,
} from "@alea/lib/filters/rangeBreakoutFade";
import type { MarketBar } from "@alea/lib/marketSeries/types";
import { describe, expect, it } from "bun:test";

const baseConfig = {
  lookbackBars: 24,
  minBreakBps: 5,
  closeLocationThreshold: 0.65,
  atrBars: 20,
  minActiveRangeAtrFraction: 0,
  priorTrendBars: 24,
  maxPriorTrendBps: 200,
} as const satisfies RangeBreakoutFadeConfig;

describe("rangeBreakoutFadeFilter", () => {
  it("fades an upside break of the recent range", () => {
    const result = evaluate({
      active: bar({
        openTimeMs: 24,
        open: 104,
        high: 106.4,
        low: 103.8,
        close: 106,
      }),
    });

    expect(result.decision).toBe("down");
    expect(result.reason).toContain("upside");
  });

  it("fades a downside break of the recent range", () => {
    const result = evaluate({
      active: bar({
        openTimeMs: 24,
        open: 101,
        high: 101.2,
        low: 98.5,
        close: 99,
      }),
    });

    expect(result.decision).toBe("up");
    expect(result.reason).toContain("downside");
  });

  it("can reject oversized breaks", () => {
    const result = evaluate({
      config: { ...baseConfig, maxBreakBps: 20 },
      active: bar({
        openTimeMs: 24,
        open: 104,
        high: 108.4,
        low: 103.8,
        close: 108,
      }),
    });

    expect(result.decision).toBe("neutral");
    expect(result.reason).toBe("break too large");
  });

  it("can reject repeated compression against the level", () => {
    const history = rangeHistory().map((historyBar, index) =>
      index >= 12 ? { ...historyBar, close: 104.95 } : historyBar,
    );
    const result = evaluate({
      config: {
        ...baseConfig,
        maxPriorTrendBps: 400,
        compressionBars: 12,
        compressionDistanceBps: 20,
        maxCompressionCount: 2,
      },
      history,
      active: bar({
        openTimeMs: 24,
        open: 104,
        high: 106.4,
        low: 103.8,
        close: 106,
      }),
    });

    expect(result.decision).toBe("neutral");
    expect(result.reason).toBe("too much compression against range edge");
  });
});

function evaluate({
  config = baseConfig,
  history = rangeHistory(),
  active,
}: {
  readonly config?: RangeBreakoutFadeConfig;
  readonly history?: readonly MarketBar[];
  readonly active: MarketBar;
}) {
  return rangeBreakoutFadeFilter.evaluate({
    asset: "eth",
    period: "15m",
    targetTsMs: Date.UTC(2026, 0, 1),
    config,
    series: {
      pyth: [...history, active],
      coinbase: Array.from({ length: history.length + 1 }, () => null),
    },
  });
}

function rangeHistory(): MarketBar[] {
  return Array.from({ length: 24 }, (_, index) =>
    bar({
      openTimeMs: index,
      open: 102,
      high: 105,
      low: 100,
      close: index % 2 === 0 ? 102.2 : 101.8,
    }),
  );
}

function bar({
  openTimeMs,
  open,
  high,
  low,
  close,
}: {
  readonly openTimeMs: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
}): MarketBar {
  return {
    openTimeMs,
    open,
    high,
    low,
    close,
    volume: 0,
  };
}
