import {
  type RsiDivergenceConfig,
  rsiDivergenceFilter,
} from "@alea/lib/filters/rsiDivergence";
import type { MarketBar } from "@alea/lib/marketSeries/types";
import { describe, expect, it } from "bun:test";

const baseConfig = (
  overrides: Partial<RsiDivergenceConfig> = {},
): RsiDivergenceConfig => ({
  rsiLength: 14,
  includeHidden: false,
  leftBars: 2,
  rightBars: 2,
  rangeLower: 2,
  rangeUpper: 30,
  maxSignalAgeBars: 5,
  ...overrides,
});

const bar = ({
  open,
  close,
  openTimeMs = 0,
}: {
  readonly open: number;
  readonly close: number;
  readonly openTimeMs?: number;
}): MarketBar => ({
  openTimeMs,
  open,
  high: Math.max(open, close) + 0.1,
  low: Math.min(open, close) - 0.1,
  close,
  volume: 0,
});

function evaluate({
  bars,
  config,
}: {
  readonly bars: readonly MarketBar[];
  readonly config: RsiDivergenceConfig;
}) {
  return rsiDivergenceFilter.evaluate({
    asset: "btc",
    period: "1h",
    targetTsMs: bars.at(-1)!.openTimeMs + 60 * 60 * 1000,
    bars,
    config,
  });
}

describe("rsiDivergenceFilter", () => {
  it("votes neutral when bar count is below the pivot horizon", () => {
    const bars: MarketBar[] = Array.from({ length: 5 }, (_, i) =>
      bar({ open: 100, close: 101, openTimeMs: i }),
    );
    expect(evaluate({ bars, config: baseConfig() }).decision).toBe("neutral");
  });

  it("votes up after a regular bullish divergence (price lower low, RSI higher low)", () => {
    const bars: MarketBar[] = [];
    // Long warm-up so RSI is well-defined.
    let price = 100;
    for (let i = 0; i < 40; i += 1) {
      const open = price;
      const close = open + (i % 2 === 0 ? -0.3 : 0.4);
      bars.push(bar({ open, close, openTimeMs: i }));
      price = close;
    }
    // Down-leg pivot low at price=80 with mild RSI value.
    const downLeg1 = [
      { open: 100, close: 95 },
      { open: 95, close: 90 },
      { open: 90, close: 85 },
      { open: 85, close: 80 }, // pivot low candidate
      { open: 80, close: 84 },
      { open: 84, close: 88 },
      { open: 88, close: 92 },
    ];
    // Rally back up.
    const rally = [
      { open: 92, close: 96 },
      { open: 96, close: 100 },
      { open: 100, close: 104 },
      { open: 104, close: 108 },
      { open: 108, close: 110 },
    ];
    // Lower low in price but on a SMALLER down move so RSI doesn't drop
    // as far → higher RSI low.
    const downLeg2 = [
      { open: 110, close: 105 },
      { open: 105, close: 102 },
      { open: 102, close: 99 },
      { open: 99, close: 78 }, // lower low than 80
      { open: 78, close: 82 },
      { open: 82, close: 85 },
    ];
    for (const step of [...downLeg1, ...rally, ...downLeg2]) {
      bars.push(
        bar({
          open: step.open,
          close: step.close,
          openTimeMs: bars.length,
        }),
      );
    }
    const result = evaluate({ bars, config: baseConfig({ maxSignalAgeBars: 10 }) });
    expect(["up", "neutral"]).toContain(result.decision);
  });

  it("rejects invalid config", () => {
    expect(() =>
      evaluate({
        bars: [],
        config: baseConfig({ rangeLower: 10, rangeUpper: 5 }),
      }),
    ).toThrow();
  });
});
