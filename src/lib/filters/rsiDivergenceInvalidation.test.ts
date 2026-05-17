import type { RsiDivergenceMatch } from "@alea/lib/filters/rsiDivergenceCore";
import {
  applyRsiDivergenceInvalidation,
  evaluateRsiDivergenceInvalidation,
  type RsiDivergenceInvalidationConfig,
} from "@alea/lib/filters/rsiDivergenceInvalidation";
import type { FilterDecision } from "@alea/lib/filters/types";
import type { RsiDivergenceKind } from "@alea/lib/indicators/rsiDivergence";
import type { MarketBar } from "@alea/lib/marketSeries/types";
import { describe, expect, it } from "bun:test";

describe("evaluateRsiDivergenceInvalidation", () => {
  it("keeps a bullish divergence alive while the agreement tally stays positive", () => {
    const match = matched({
      decision: "up",
      kind: "regular_bullish",
      bars: [
        bar({ open: 100, close: 100 }),
        bar({ open: 100, close: 101 }),
        bar({ open: 101, close: 102 }),
        bar({ open: 102, close: 101 }),
      ],
    });

    const result = evaluateRsiDivergenceInvalidation({
      match,
      config: config(),
    });

    expect(result.invalidated).toBe(false);
    expect(result.metadata?.["agreementScore"]).toBe(1);
    expect(result.metadata?.["agreementCount"]).toBe(2);
    expect(result.metadata?.["disagreementCount"]).toBe(1);
  });

  it("keeps a bearish divergence alive while down candles outnumber up candles", () => {
    const match = matched({
      decision: "down",
      kind: "regular_bearish",
      bars: [
        bar({ open: 100, close: 100 }),
        bar({ open: 100, close: 99 }),
        bar({ open: 99, close: 98 }),
        bar({ open: 98, close: 99 }),
      ],
    });

    const result = evaluateRsiDivergenceInvalidation({
      match,
      config: config(),
    });

    expect(result.invalidated).toBe(false);
    expect(result.metadata?.["agreementScore"]).toBe(1);
  });

  it("invalidates when the agreement tally goes negative", () => {
    const match = matched({
      decision: "up",
      kind: "hidden_bullish",
      bars: [
        bar({ open: 100, close: 100 }),
        bar({ open: 100, close: 99 }),
      ],
    });

    const result = evaluateRsiDivergenceInvalidation({
      match,
      config: config(),
    });

    expect(result.invalidated).toBe(true);
    expect(result.metadata?.["invalidation"]).toBe(
      "negative_agreement_tally",
    );
    expect(result.metadata?.["invalidationOpenTimeMs"]).toBe(60_000);
  });

  it("invalidates after two consecutive disagreeing candles even if the tally is not negative", () => {
    const match = matched({
      decision: "up",
      kind: "regular_bullish",
      bars: [
        bar({ open: 100, close: 100 }),
        bar({ open: 100, close: 101 }),
        bar({ open: 101, close: 102 }),
        bar({ open: 102, close: 101 }),
        bar({ open: 101, close: 100 }),
      ],
    });

    const result = evaluateRsiDivergenceInvalidation({
      match,
      config: config(),
    });

    expect(result.invalidated).toBe(true);
    expect(result.metadata?.["invalidation"]).toBe(
      "two_consecutive_disagreements",
    );
    expect(result.metadata?.["agreementScore"]).toBe(0);
  });

  it("treats exact flat candles as neutral and resets the consecutive disagreement streak", () => {
    const match = matched({
      decision: "down",
      kind: "hidden_bearish",
      bars: [
        bar({ open: 100, close: 100 }),
        bar({ open: 100, close: 99 }),
        bar({ open: 99, close: 100 }),
        bar({ open: 100, close: 99 }),
        bar({ open: 99, close: 99 }),
        bar({ open: 99, close: 100 }),
      ],
    });

    const result = evaluateRsiDivergenceInvalidation({
      match,
      config: config(),
    });

    expect(result.invalidated).toBe(false);
    expect(result.metadata?.["agreementScore"]).toBe(0);
  });

  it("allows deeper negative agreement scores when configured", () => {
    const match = matched({
      decision: "up",
      kind: "regular_bullish",
      bars: [
        bar({ open: 100, close: 100 }),
        bar({ open: 100, close: 99 }),
      ],
    });

    const result = evaluateRsiDivergenceInvalidation({
      match,
      config: config({
        minAgreementScore: -1,
        maxConsecutiveDisagreements: 3,
      }),
    });

    expect(result.invalidated).toBe(false);
    expect(result.metadata?.["agreementScore"]).toBe(-1);
  });

  it("can invalidate on the first disagreeing candle when configured", () => {
    const match = matched({
      decision: "down",
      kind: "regular_bearish",
      bars: [
        bar({ open: 100, close: 100 }),
        bar({ open: 100, close: 101 }),
      ],
    });

    const result = evaluateRsiDivergenceInvalidation({
      match,
      config: config({
        minAgreementScore: -3,
        maxConsecutiveDisagreements: 1,
      }),
    });

    expect(result.invalidated).toBe(true);
    expect(result.metadata?.["invalidation"]).toBe(
      "two_consecutive_disagreements",
    );
    expect(result.metadata?.["maxConsecutiveDisagreements"]).toBe(1);
  });
});

describe("applyRsiDivergenceInvalidation", () => {
  it("turns an invalidated RSI divergence into neutral", () => {
    const match = matched({
      decision: "down",
      kind: "regular_bearish",
      bars: [
        bar({ open: 100, close: 100 }),
        bar({ open: 100, close: 101 }),
      ],
    });

    const evaluation = applyRsiDivergenceInvalidation({
      match,
      config: config(),
    });

    expect(evaluation.decision).toBe("neutral");
    expect(evaluation.metadata?.["invalidation"]).toBe(
      "negative_agreement_tally",
    );
  });
});

function config(
  overrides: Partial<RsiDivergenceInvalidationConfig> = {},
): RsiDivergenceInvalidationConfig {
  return {
    minAgreementScore: 0,
    maxConsecutiveDisagreements: 2,
    ...overrides,
  };
}

function matched({
  decision,
  kind,
  bars,
  confirmedIndex = 0,
}: {
  readonly decision: Exclude<FilterDecision, "neutral">;
  readonly kind: RsiDivergenceKind;
  readonly bars: readonly MarketBar[];
  readonly confirmedIndex?: number;
}): Extract<RsiDivergenceMatch, { readonly matched: true }> {
  const indexedBars = bars.map((bar, index) => ({
    ...bar,
    openTimeMs: index * 60_000,
  }));
  const lastIndex = indexedBars.length - 1;
  return {
    matched: true,
    bars: indexedBars,
    lastIndex,
    signal: {
      kind,
      pivotIndex: confirmedIndex - 5,
      previousPivotIndex: confirmedIndex - 20,
      confirmedIndex,
      price: 100,
      previousPrice: 101,
      rsi: 40,
      previousRsi: 45,
    },
    decision,
    barsAgo: lastIndex - confirmedIndex,
    evaluation: {
      decision,
      reason: `${kind} confirmed on current bar`,
      metadata: { kind },
    },
  };
}

function bar({
  open,
  close,
}: {
  readonly open: number;
  readonly close: number;
}): MarketBar {
  return {
    openTimeMs: 0,
    open,
    high: Math.max(open, close),
    low: Math.min(open, close),
    close,
    volume: 0,
  };
}
