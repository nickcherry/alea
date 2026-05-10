import {
  computeDivergenceSeries,
  detectDivergencesGivenRsi,
  type DivergenceBar,
  labelAt,
} from "@alea/lib/training/regimeAlgos/rsiDivergence/computeDivergence";
import type { RsiDivergenceConfig } from "@alea/lib/training/regimeAlgos/rsiDivergence/types";
import { describe, expect, it } from "bun:test";

const FIVE_MIN_MS = 5 * 60 * 1000;

const baseConfig: RsiDivergenceConfig = {
  rsiLength: 14,
  lbL: 5,
  lbR: 5,
  rangeLower: 5,
  rangeUpper: 60,
  lookbackBars: 5,
};

/**
 * Build a bar series of length N with neutral OHLC at `100`, then
 * stamp specific (high, low) on the indices listed in `pivots`. The
 * pivot bars are the only ones that matter for the price-comparison
 * side of the divergence test; the rest can be ignored.
 */
function makeBars({
  length,
  pivots,
}: {
  length: number;
  pivots: Record<number, { high?: number; low?: number }>;
}): DivergenceBar[] {
  return Array.from({ length }, (_, i) => ({
    openTimeMs: i * FIVE_MIN_MS,
    high: pivots[i]?.high ?? 100,
    low: pivots[i]?.low ?? 100,
    close: 100,
  }));
}

/**
 * Build a hand-crafted RSI series of length N. `rsi` is a record from
 * index → value; missing indices default to 50 (neutral, won't form
 * pivots against engineered extremes). Index `0..rsiLength-1` are
 * filled with `null` to match what `computeWilderRsiSeries` would
 * actually emit during warmup.
 */
function makeRsi({
  length,
  rsi,
  warmup = baseConfig.rsiLength,
}: {
  length: number;
  rsi: Record<number, number>;
  warmup?: number;
}): (number | null)[] {
  return Array.from({ length }, (_, i) => {
    if (i < warmup) {
      return null;
    }
    return rsi[i] ?? 50;
  });
}

describe("computeDivergenceSeries", () => {
  it("returns empty arrays for an empty input", () => {
    const out = computeDivergenceSeries({
      bars: [],
      config: baseConfig,
    });
    expect(out.flagsByIndex).toEqual([]);
    expect(out.rsiByIndex).toEqual([]);
  });

  it("emits no flags when there's no pivot pattern", () => {
    // 30 bars of constant prices → constant (degenerate) RSI → no
    // strict pivots can form.
    const bars: DivergenceBar[] = Array.from({ length: 30 }, (_, i) => ({
      openTimeMs: i * FIVE_MIN_MS,
      high: 100,
      low: 100,
      close: 100,
    }));
    const out = computeDivergenceSeries({ bars, config: baseConfig });
    expect(out.flagsByIndex.every((f) => !f.flagged)).toBe(true);
  });
});

describe("detectDivergencesGivenRsi (hand-crafted RSI)", () => {
  /**
   * Two RSI pivot lows at indices 20 and 40, ten bars apart. The
   * second pivot is HIGHER in RSI (40 > 30) but LOWER in price
   * (low=88 vs low=92). Classic regular bullish divergence.
   *
   * Both pivots complete `lbR=5` bars later, so we expect the
   * regBull flag on bar 45.
   */
  it("flags regular bullish: price LL + RSI HL", () => {
    const length = 60;
    const bars = makeBars({
      length,
      pivots: {
        20: { low: 92, high: 92 },
        40: { low: 88, high: 88 },
      },
    });
    const rsiByIndex = makeRsi({
      length,
      rsi: { 20: 30, 40: 40 },
    });
    const flags = detectDivergencesGivenRsi({
      bars,
      rsiByIndex,
      config: baseConfig,
    });
    // Pivot at idx 40 completes at bar 40+lbR=45.
    expect(flags[45]!.regBull).toBe(true);
    expect(flags[45]!.hidBull).toBe(false);
    expect(flags[45]!.regBear).toBe(false);
    expect(flags[45]!.hidBear).toBe(false);
  });

  it("flags hidden bullish: price HL + RSI LL", () => {
    const length = 60;
    const bars = makeBars({
      length,
      pivots: {
        20: { low: 88 },
        40: { low: 92 }, // higher low in price
      },
    });
    const rsiByIndex = makeRsi({
      length,
      rsi: { 20: 40, 40: 30 }, // lower low in RSI
    });
    const flags = detectDivergencesGivenRsi({
      bars,
      rsiByIndex,
      config: baseConfig,
    });
    expect(flags[45]!.hidBull).toBe(true);
    expect(flags[45]!.regBull).toBe(false);
  });

  it("flags regular bearish: price HH + RSI LH", () => {
    const length = 60;
    const bars = makeBars({
      length,
      pivots: {
        20: { high: 108 },
        40: { high: 112 }, // higher high in price
      },
    });
    const rsiByIndex = makeRsi({
      length,
      rsi: { 20: 70, 40: 60 }, // lower high in RSI
    });
    const flags = detectDivergencesGivenRsi({
      bars,
      rsiByIndex,
      config: baseConfig,
    });
    expect(flags[45]!.regBear).toBe(true);
    expect(flags[45]!.hidBear).toBe(false);
  });

  it("flags hidden bearish: price LH + RSI HH", () => {
    const length = 60;
    const bars = makeBars({
      length,
      pivots: {
        20: { high: 112 },
        40: { high: 108 }, // lower high in price
      },
    });
    const rsiByIndex = makeRsi({
      length,
      rsi: { 20: 60, 40: 70 }, // higher high in RSI
    });
    const flags = detectDivergencesGivenRsi({
      bars,
      rsiByIndex,
      config: baseConfig,
    });
    expect(flags[45]!.hidBear).toBe(true);
    expect(flags[45]!.regBear).toBe(false);
  });

  it("does NOT flag when consecutive pivots are closer than rangeLower", () => {
    // Pivots 4 bars apart, rangeLower = 5 → range check fails.
    const length = 60;
    const bars = makeBars({
      length,
      pivots: {
        20: { low: 92 },
        24: { low: 88 },
      },
    });
    const rsiByIndex = makeRsi({
      length,
      rsi: { 20: 30, 24: 40 },
    });
    const flags = detectDivergencesGivenRsi({
      bars,
      rsiByIndex,
      config: { ...baseConfig, rangeLower: 5 },
    });
    expect(flags.every((f) => !f.regBull)).toBe(true);
  });

  it("does NOT flag when consecutive pivots are farther than rangeUpper", () => {
    const length = 200;
    const bars = makeBars({
      length,
      pivots: {
        20: { low: 92 },
        150: { low: 88 }, // 130 bars apart > rangeUpper=60
      },
    });
    const rsiByIndex = makeRsi({
      length,
      rsi: { 20: 30, 150: 40 },
    });
    const flags = detectDivergencesGivenRsi({
      bars,
      rsiByIndex,
      config: { ...baseConfig, rangeUpper: 60 },
    });
    expect(flags.every((f) => !f.regBull)).toBe(true);
  });

  it("does NOT flag the first pivot (no prior pivot to compare against)", () => {
    const length = 30;
    const bars = makeBars({
      length,
      pivots: { 15: { low: 90 } },
    });
    const rsiByIndex = makeRsi({
      length,
      rsi: { 15: 30 },
    });
    const flags = detectDivergencesGivenRsi({
      bars,
      rsiByIndex,
      config: baseConfig,
    });
    expect(flags.every((f) => !f.flagged)).toBe(true);
  });
});

describe("labelAt", () => {
  it("returns no_div when nothing is flagged in the lookback window", () => {
    const flags = Array.from({ length: 10 }, () => ({
      regBull: false,
      hidBull: false,
      regBear: false,
      hidBear: false,
      flagged: false,
    }));
    expect(labelAt({ flagsByIndex: flags, atIdx: 9, lookbackBars: 5 })).toBe(
      "no_div",
    );
  });

  it("returns the most recent active label within the lookback", () => {
    const flags = [
      {
        regBull: true,
        hidBull: false,
        regBear: false,
        hidBear: false,
        flagged: true,
      },
      {
        regBull: false,
        hidBull: false,
        regBear: false,
        hidBear: false,
        flagged: false,
      },
      {
        regBull: false,
        hidBull: false,
        regBear: true,
        hidBear: false,
        flagged: true,
      },
      {
        regBull: false,
        hidBull: false,
        regBear: false,
        hidBear: false,
        flagged: false,
      },
    ];
    expect(labelAt({ flagsByIndex: flags, atIdx: 3, lookbackBars: 4 })).toBe(
      "bear_div",
    );
  });

  it("ignores events older than the lookback window", () => {
    const flags = [
      {
        regBull: true,
        hidBull: false,
        regBear: false,
        hidBear: false,
        flagged: true,
      },
      {
        regBull: false,
        hidBull: false,
        regBear: false,
        hidBear: false,
        flagged: false,
      },
      {
        regBull: false,
        hidBull: false,
        regBear: false,
        hidBear: false,
        flagged: false,
      },
      {
        regBull: false,
        hidBull: false,
        regBear: false,
        hidBear: false,
        flagged: false,
      },
    ];
    expect(labelAt({ flagsByIndex: flags, atIdx: 3, lookbackBars: 3 })).toBe(
      "no_div",
    );
  });

  it("prefers regular over hidden when both fire on the same bar", () => {
    const flags = [
      {
        regBull: false,
        hidBull: true,
        regBear: true,
        hidBear: false,
        flagged: true,
      },
    ];
    // Tiebreaker order: regBull > regBear > hidBull > hidBear. Both
    // regBear and hidBull are set; regBear wins.
    expect(labelAt({ flagsByIndex: flags, atIdx: 0, lookbackBars: 1 })).toBe(
      "bear_div",
    );
  });
});
