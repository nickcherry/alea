import {
  applyExtensionReversalLifecycle,
  extensionReversalFilter,
} from "@alea/lib/filters/extensionReversal";
import {
  type ExtensionReversalBaseConfig,
  findRecentExtensionReversal,
} from "@alea/lib/filters/extensionReversalCore";
import type { ThesisLifecycleConfig } from "@alea/lib/filters/thesisLifecycle";
import type {
  AlignedMarketSeries,
  MarketBar,
} from "@alea/lib/marketSeries/types";
import { describe, expect, it } from "bun:test";

const baseConfig = (
  overrides: Partial<ExtensionReversalBaseConfig> = {},
): ExtensionReversalBaseConfig => ({
  minSynthReturnPct: 0.02,
  minLastReturnPct: 0.01,
  maxSignalAgeBars: 0,
  allowedDirection: "both",
  minStreakLength: 0,
  minConfluenceCount: 0,
  confluenceMinSynthReturnPct: 0.02,
  confluenceMinLastReturnPct: 0.01,
  ...overrides,
});

const lifecycleConfig = (
  overrides: Partial<ThesisLifecycleConfig> = {},
): ThesisLifecycleConfig => ({
  maxAge: 4,
  maxConsecutiveWrong: 1,
  requireWrongLessThanRight: false,
  requireFirstTradeWin: false,
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

function buildHistory({
  count,
  startPrice = 100,
}: {
  readonly count: number;
  readonly startPrice?: number;
}): MarketBar[] {
  const bars: MarketBar[] = [];
  let price = startPrice;
  for (let i = 0; i < count; i += 1) {
    const open = price;
    const close = open + 0.05;
    bars.push(bar({ open, close, openTimeMs: i }));
    price = close;
  }
  return bars;
}

describe("findRecentExtensionReversal", () => {
  it("fires bearish when synth and last closed both push up beyond thresholds", () => {
    const bars = buildHistory({ count: 80 });
    const lastClosedOpen = bars.at(-1)!.close;
    const lastClosed = bar({
      open: lastClosedOpen,
      close: lastClosedOpen * 1.012,
      openTimeMs: 80,
    });
    const synthOpen = lastClosed.close;
    const synth = bar({
      open: synthOpen,
      close: synthOpen * 1.022,
      openTimeMs: 81,
    });
    bars.push(lastClosed, synth);
    const match = findRecentExtensionReversal({ bars, config: baseConfig() });
    expect(match.matched).toBe(true);
    if (match.matched) {
      expect(match.trigger.direction).toBe("down");
      expect(match.trigger.synthReturnPct).toBeGreaterThan(0);
      expect(match.trigger.lastReturnPct).toBeGreaterThan(0);
      expect(match.barsAgo).toBe(0);
    }
  });

  it("fires bullish when synth and last closed both push down beyond thresholds", () => {
    const bars = buildHistory({ count: 80 });
    const lastClosedOpen = bars.at(-1)!.close;
    const lastClosed = bar({
      open: lastClosedOpen,
      close: lastClosedOpen * 0.985,
      openTimeMs: 80,
    });
    const synthOpen = lastClosed.close;
    const synth = bar({
      open: synthOpen,
      close: synthOpen * 0.975,
      openTimeMs: 81,
    });
    bars.push(lastClosed, synth);
    const match = findRecentExtensionReversal({ bars, config: baseConfig() });
    expect(match.matched).toBe(true);
    if (match.matched) {
      expect(match.trigger.direction).toBe("up");
    }
  });

  it("does not fire if synth and last move opposite directions", () => {
    const bars = buildHistory({ count: 80 });
    const lastClosedOpen = bars.at(-1)!.close;
    const lastClosed = bar({
      open: lastClosedOpen,
      close: lastClosedOpen * 1.015,
      openTimeMs: 80,
    });
    const synthOpen = lastClosed.close;
    const synth = bar({
      open: synthOpen,
      close: synthOpen * 0.975,
      openTimeMs: 81,
    });
    bars.push(lastClosed, synth);
    const match = findRecentExtensionReversal({ bars, config: baseConfig() });
    expect(match.matched).toBe(false);
  });

  it("does not fire when synth magnitude is below threshold", () => {
    const bars = buildHistory({ count: 80 });
    const lastClosedOpen = bars.at(-1)!.close;
    const lastClosed = bar({
      open: lastClosedOpen,
      close: lastClosedOpen * 1.015,
      openTimeMs: 80,
    });
    const synthOpen = lastClosed.close;
    const synth = bar({
      open: synthOpen,
      close: synthOpen * 1.005,
      openTimeMs: 81,
    });
    bars.push(lastClosed, synth);
    const match = findRecentExtensionReversal({ bars, config: baseConfig() });
    expect(match.matched).toBe(false);
  });

  it("respects allowedDirection: 'up' (only fires after down-extensions)", () => {
    const bars = buildHistory({ count: 80 });
    const lastClosedOpen = bars.at(-1)!.close;
    bars.push(
      bar({
        open: lastClosedOpen,
        close: lastClosedOpen * 1.015,
        openTimeMs: 80,
      }),
    );
    bars.push(
      bar({
        open: bars.at(-1)!.close,
        close: bars.at(-1)!.close * 1.025,
        openTimeMs: 81,
      }),
    );
    const match = findRecentExtensionReversal({
      bars,
      config: baseConfig({ allowedDirection: "up" }),
    });
    expect(match.matched).toBe(false);
  });

  it("respects allowedDirection: 'up' (fires after down-extensions)", () => {
    const bars = buildHistory({ count: 80 });
    const lastClosedOpen = bars.at(-1)!.close;
    bars.push(
      bar({
        open: lastClosedOpen,
        close: lastClosedOpen * 0.985,
        openTimeMs: 80,
      }),
    );
    bars.push(
      bar({
        open: bars.at(-1)!.close,
        close: bars.at(-1)!.close * 0.975,
        openTimeMs: 81,
      }),
    );
    const match = findRecentExtensionReversal({
      bars,
      config: baseConfig({ allowedDirection: "up" }),
    });
    expect(match.matched).toBe(true);
    if (match.matched) {
      expect(match.trigger.direction).toBe("up");
    }
  });

  it("respects minStreakLength: requires N prior same-dir closed bars", () => {
    const bars = buildHistory({ count: 80 });
    const lastClosedOpen = bars.at(-1)!.close;
    bars.push(
      bar({
        open: lastClosedOpen,
        close: lastClosedOpen * 0.985,
        openTimeMs: 80,
      }),
    );
    bars.push(
      bar({
        open: bars.at(-1)!.close,
        close: bars.at(-1)!.close * 0.975,
        openTimeMs: 81,
      }),
    );
    const noStreakMatch = findRecentExtensionReversal({
      bars,
      config: baseConfig({ allowedDirection: "up", minStreakLength: 3 }),
    });
    expect(noStreakMatch.matched).toBe(false);
  });

  it("records streak length on the trigger", () => {
    const bars: MarketBar[] = [];
    let price = 100;
    for (let i = 0; i < 75; i += 1) {
      const open = price;
      const close = open + 0.05;
      bars.push(bar({ open, close, openTimeMs: i }));
      price = close;
    }
    for (let i = 0; i < 3; i += 1) {
      const open = price;
      const close = open * 0.985;
      bars.push(bar({ open, close, openTimeMs: 75 + i }));
      price = close;
    }
    const synthOpen = price;
    bars.push(
      bar({
        open: synthOpen,
        close: synthOpen * 0.975,
        openTimeMs: 78,
      }),
    );
    const match = findRecentExtensionReversal({
      bars,
      config: baseConfig({ allowedDirection: "up", minStreakLength: 2 }),
    });
    expect(match.matched).toBe(true);
    if (match.matched) {
      expect(match.trigger.streakLength).toBeGreaterThanOrEqual(3);
      expect(match.trigger.direction).toBe("up");
    }
  });
});

describe("applyExtensionReversalLifecycle", () => {
  it("invalidates when subsequent bar moves wrong direction once", () => {
    const bars = buildHistory({ count: 80 });
    const lastClosedOpen = bars.at(-1)!.close;
    const lastClosed = bar({
      open: lastClosedOpen,
      close: lastClosedOpen * 1.012,
      openTimeMs: 80,
    });
    const synthOpen = lastClosed.close;
    const synth = bar({
      open: synthOpen,
      close: synthOpen * 1.022,
      openTimeMs: 81,
    });
    bars.push(lastClosed, synth);
    bars.push(
      bar({ open: synth.close, close: synth.close * 1.015, openTimeMs: 82 }),
    );
    const match = findRecentExtensionReversal({
      bars,
      config: baseConfig({ maxSignalAgeBars: 5 }),
    });
    if (!match.matched) {
      throw new Error("expected match");
    }
    const evaluation = applyExtensionReversalLifecycle({
      match,
      config: lifecycleConfig({ maxConsecutiveWrong: 1 }),
    });
    expect(evaluation.decision).toBe("neutral");
  });
});

describe("extensionReversalFilter integration", () => {
  it("evaluates through the TradingFilter interface", () => {
    const bars = buildHistory({ count: 80 });
    const lastClosedOpen = bars.at(-1)!.close;
    bars.push(
      bar({
        open: lastClosedOpen,
        close: lastClosedOpen * 1.012,
        openTimeMs: 80,
      }),
    );
    bars.push(
      bar({
        open: bars.at(-1)!.close,
        close: bars.at(-1)!.close * 1.022,
        openTimeMs: 81,
      }),
    );
    const series: AlignedMarketSeries = {
      pyth: bars,
      coinbase: bars.map(() => null),
    };
    const result = extensionReversalFilter.evaluate({
      asset: "btc",
      period: "1h",
      targetTsMs: bars.at(-1)!.openTimeMs,
      series,
      config: { ...baseConfig(), ...lifecycleConfig() },
    });
    expect(result.decision).toBe("down");
  });
});
