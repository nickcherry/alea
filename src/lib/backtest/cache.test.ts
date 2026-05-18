import {
  candidateBacktestCacheHash,
  candidateBacktestInputDataHash,
  quarterLabelFor,
  quarterStartFor,
  quarterWindowFor,
} from "@alea/lib/backtest/cache";
import type { FilterCandidate } from "@alea/lib/filters/types";
import type { MarketBar } from "@alea/lib/marketSeries/types";
import { describe, expect, it } from "bun:test";

describe("candidateBacktestCacheHash", () => {
  it("changes when cache-invalidating inputs change", () => {
    const base = {
      candidate: candidate({ configCanon: '{"length":14}', version: 2 }),
      asset: "btc",
      period: "1h",
      source: "pyth",
      quarterStartMs: Date.UTC(2026, 3, 1),
      windowStartMs: Date.UTC(2026, 4, 1),
      windowEndMs: Date.UTC(2026, 4, 2),
      decisionSchemaVersion: 2,
      engineVersion: 8,
      hydrateBars: 288,
      takeProfitPct: 0.05,
      outcomeWindowBars: 5,
      inputDataHash: "data-a",
    } as const;
    const hash = candidateBacktestCacheHash(base);

    expect(hash).toHaveLength(32);
    expect(
      candidateBacktestCacheHash({
        ...base,
        candidate: candidate({ configCanon: '{"length":21}', version: 2 }),
      }),
    ).not.toBe(hash);
    expect(
      candidateBacktestCacheHash({
        ...base,
        candidate: candidate({ configCanon: '{"length":14}', version: 3 }),
      }),
    ).not.toBe(hash);
    expect(
      candidateBacktestCacheHash({ ...base, takeProfitPct: 0.04 }),
    ).not.toBe(hash);
    expect(
      candidateBacktestCacheHash({ ...base, outcomeWindowBars: 6 }),
    ).not.toBe(hash);
    expect(
      candidateBacktestCacheHash({
        ...base,
        windowEndMs: Date.UTC(2026, 4, 3),
      }),
    ).not.toBe(hash);
    expect(
      candidateBacktestCacheHash({ ...base, inputDataHash: "data-b" }),
    ).not.toBe(hash);
  });
});

describe("candidateBacktestInputDataHash", () => {
  it("changes when candle inputs change inside the covered window", () => {
    const base = {
      periodBars: [bar({ openTimeMs: 0, close: 100 })],
      periodStartMs: 0,
      windowEndMs: 60_000,
    } as const;
    const hash = candidateBacktestInputDataHash(base);

    expect(hash).toHaveLength(32);
    expect(
      candidateBacktestInputDataHash({
        ...base,
        periodBars: [bar({ openTimeMs: 0, close: 101 })],
      }),
    ).not.toBe(hash);
    // Bars outside the window don't change the hash.
    expect(
      candidateBacktestInputDataHash({
        ...base,
        periodBars: [
          bar({ openTimeMs: 0, close: 100 }),
          bar({ openTimeMs: 60_000, close: 101 }),
        ],
      }),
    ).toBe(hash);
  });
});

describe("quarterWindowFor", () => {
  it("clips row windows to the requested range inside a quarter", () => {
    const quarterStartMs = quarterStartFor({
      tsMs: Date.UTC(2026, 4, 16),
    });

    expect(quarterStartMs).toBe(Date.UTC(2026, 3, 1));
    expect(quarterLabelFor({ quarterStartMs })).toBe("2026 Q2");
    expect(
      quarterWindowFor({
        quarterStartMs,
        startMs: Date.UTC(2026, 4, 1),
        endMs: Date.UTC(2026, 4, 2),
      }),
    ).toEqual({
      windowStartMs: Date.UTC(2026, 4, 1),
      windowEndMs: Date.UTC(2026, 4, 2),
    });
  });
});

function candidate({
  configCanon,
  version,
}: {
  readonly configCanon: string;
  readonly version: number;
}): FilterCandidate {
  return {
    id: `rsi_divergence@v${version}:abc`,
    filterId: "rsi_divergence",
    filterName: "RSI Divergence",
    filterVersion: version,
    description: "Test candidate.",
    sources: [],
    config: {},
    configCanon,
    configHash: configCanon,
    evaluate: () => ({ decision: "neutral" }),
  };
}

function bar({
  openTimeMs,
  close,
}: {
  readonly openTimeMs: number;
  readonly close: number;
}): MarketBar {
  return {
    openTimeMs,
    open: close,
    high: close,
    low: close,
    close,
    volume: 0,
  };
}
