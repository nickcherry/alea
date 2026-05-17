import type { RsiDivergenceConfig } from "@alea/lib/filters/rsiDivergence";
import { selectRecentRsiDivergenceSignal } from "@alea/lib/filters/rsiDivergence";
import type {
  RsiDivergenceKind,
  RsiDivergenceSignal,
} from "@alea/lib/indicators/rsiDivergence";
import { describe, expect, it } from "bun:test";

describe("selectRecentRsiDivergenceSignal", () => {
  it("uses maxSignalAgeBars as confirmed bars ago from the current synthetic bar", () => {
    const signals = [
      signal({ kind: "regular_bullish", confirmedIndex: 99 }),
      signal({ kind: "regular_bearish", confirmedIndex: 100 }),
    ];

    expect(
      selectRecentRsiDivergenceSignal({
        signals,
        lastIndex: 100,
        config: config({ maxSignalAgeBars: 0 }),
      })?.kind,
    ).toBe("regular_bearish");
    expect(
      selectRecentRsiDivergenceSignal({
        signals: [signals[0]!],
        lastIndex: 100,
        config: config({ maxSignalAgeBars: 0 }),
      }),
    ).toBeUndefined();
    expect(
      selectRecentRsiDivergenceSignal({
        signals: [signals[0]!],
        lastIndex: 100,
        config: config({ maxSignalAgeBars: 1 }),
      })?.kind,
    ).toBe("regular_bullish");
  });

  it("can require a minimum confirmed age", () => {
    const fresh = signal({ kind: "regular_bullish", confirmedIndex: 99 });
    const aged = signal({ kind: "regular_bearish", confirmedIndex: 92 });

    expect(
      selectRecentRsiDivergenceSignal({
        signals: [aged, fresh],
        lastIndex: 100,
        config: config({ minSignalAgeBars: 8, maxSignalAgeBars: 15 }),
      })?.kind,
    ).toBe("regular_bearish");
    expect(
      selectRecentRsiDivergenceSignal({
        signals: [fresh],
        lastIndex: 100,
        config: config({ minSignalAgeBars: 8, maxSignalAgeBars: 15 }),
      }),
    ).toBeUndefined();
  });

  it("returns no opinion when there is no divergence inside the window", () => {
    expect(
      selectRecentRsiDivergenceSignal({
        signals: [signal({ kind: "regular_bullish", confirmedIndex: 84 })],
        lastIndex: 100,
        config: config({ maxSignalAgeBars: 15 }),
      }),
    ).toBeUndefined();
  });

  it("keeps hidden divergences disabled unless the config enables them", () => {
    const hidden = signal({ kind: "hidden_bullish", confirmedIndex: 100 });

    expect(
      selectRecentRsiDivergenceSignal({
        signals: [hidden],
        lastIndex: 100,
        config: config({ includeHidden: false, maxSignalAgeBars: 0 }),
      }),
    ).toBeUndefined();
    expect(
      selectRecentRsiDivergenceSignal({
        signals: [hidden],
        lastIndex: 100,
        config: config({ includeHidden: true, maxSignalAgeBars: 0 }),
      })?.kind,
    ).toBe("hidden_bullish");
  });
});

function config(overrides: Partial<RsiDivergenceConfig>): RsiDivergenceConfig {
  return {
    rsiLength: 14,
    includeHidden: false,
    leftBars: 5,
    rightBars: 5,
    rangeLower: 5,
    rangeUpper: 60,
    maxSignalAgeBars: 0,
    minAgreementScore: 0,
    maxConsecutiveDisagreements: 2,
    ...overrides,
  };
}

function signal({
  kind,
  confirmedIndex,
}: {
  readonly kind: RsiDivergenceKind;
  readonly confirmedIndex: number;
}): RsiDivergenceSignal {
  return {
    kind,
    pivotIndex: confirmedIndex - 5,
    previousPivotIndex: confirmedIndex - 20,
    confirmedIndex,
    price: 100,
    previousPrice: 101,
    rsi: 40,
    previousRsi: 35,
  };
}
