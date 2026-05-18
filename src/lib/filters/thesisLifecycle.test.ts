import {
  runThesisLifecycle,
  type ThesisLifecycleConfig,
  verdictForBar,
} from "@alea/lib/filters/thesisLifecycle";
import type { MarketBar } from "@alea/lib/marketSeries/types";
import { describe, expect, it } from "bun:test";

const baseConfig = (
  overrides: Partial<ThesisLifecycleConfig> = {},
): ThesisLifecycleConfig => ({
  maxAge: 0,
  maxConsecutiveWrong: 2,
  requireWrongLessThanRight: false,
  requireFirstTradeWin: false,
  ...overrides,
});

const bar = ({
  open,
  close,
  openTimeMs = 0,
  high,
  low,
}: {
  open: number;
  close: number;
  openTimeMs?: number;
  high?: number;
  low?: number;
}): MarketBar => ({
  openTimeMs,
  open,
  close,
  high: high ?? Math.max(open, close),
  low: low ?? Math.min(open, close),
  volume: 0,
});

describe("verdictForBar", () => {
  it("treats up close as right for up thesis", () => {
    expect(verdictForBar({ direction: "up", open: 100, close: 101 })).toBe(
      "right",
    );
  });

  it("treats down close as right for down thesis", () => {
    expect(verdictForBar({ direction: "down", open: 100, close: 99 })).toBe(
      "right",
    );
  });

  it("treats flat close as flat regardless of direction", () => {
    expect(verdictForBar({ direction: "up", open: 100, close: 100 })).toBe(
      "flat",
    );
    expect(verdictForBar({ direction: "down", open: 100, close: 100 })).toBe(
      "flat",
    );
  });
});

describe("runThesisLifecycle", () => {
  it("keeps thesis alive while right bars outpace wrong bars", () => {
    const result = runThesisLifecycle({
      direction: "up",
      confirmedIndex: 0,
      bars: [
        bar({ open: 100, close: 100 }),
        bar({ open: 100, close: 101 }),
        bar({ open: 101, close: 102 }),
        bar({ open: 102, close: 101 }),
      ],
      lastIndex: 3,
      config: baseConfig(),
    });
    expect(result.invalidated).toBe(false);
    expect(result.metadata["right"]).toBe(2);
    expect(result.metadata["wrong"]).toBe(1);
  });

  it("invalidates on two consecutive wrong bars by default", () => {
    const result = runThesisLifecycle({
      direction: "up",
      confirmedIndex: 0,
      bars: [
        bar({ open: 100, close: 100 }),
        bar({ open: 100, close: 99 }),
        bar({ open: 99, close: 98 }),
      ],
      lastIndex: 2,
      config: baseConfig(),
    });
    expect(result.invalidated).toBe(true);
    expect(result.metadata["invalidation"]).toBe("consecutive_wrong");
  });

  it("invalidates immediately when first bar is wrong and requireFirstTradeWin is set", () => {
    const result = runThesisLifecycle({
      direction: "up",
      confirmedIndex: 0,
      bars: [bar({ open: 100, close: 100 }), bar({ open: 100, close: 99 })],
      lastIndex: 1,
      config: baseConfig({ requireFirstTradeWin: true }),
    });
    expect(result.invalidated).toBe(true);
    expect(result.metadata["invalidation"]).toBe("first_trade_wrong");
  });

  it("invalidates when wrong exceeds right and requireWrongLessThanRight is set", () => {
    const result = runThesisLifecycle({
      direction: "up",
      confirmedIndex: 0,
      bars: [
        bar({ open: 100, close: 100 }),
        bar({ open: 100, close: 101 }),
        bar({ open: 101, close: 100 }),
        bar({ open: 100, close: 99 }),
      ],
      lastIndex: 3,
      config: baseConfig({
        maxConsecutiveWrong: 0,
        requireWrongLessThanRight: true,
      }),
    });
    expect(result.invalidated).toBe(true);
    expect(result.metadata["invalidation"]).toBe("wrong_exceeds_right");
  });

  it("invalidates when age exceeds maxAge", () => {
    const result = runThesisLifecycle({
      direction: "up",
      confirmedIndex: 0,
      bars: [
        bar({ open: 100, close: 100 }),
        bar({ open: 100, close: 101 }),
        bar({ open: 101, close: 102 }),
        bar({ open: 102, close: 103 }),
        bar({ open: 103, close: 104 }),
      ],
      lastIndex: 4,
      config: baseConfig({ maxAge: 3 }),
    });
    expect(result.invalidated).toBe(true);
    expect(result.metadata["invalidation"]).toBe("max_age");
    expect(result.metadata["age"]).toBe(4);
  });

  it("honors structural invalidation provided by the caller", () => {
    const result = runThesisLifecycle({
      direction: "up",
      confirmedIndex: 0,
      bars: [
        bar({ open: 100, close: 100 }),
        bar({ open: 100, close: 99, low: 95 }),
      ],
      lastIndex: 1,
      config: baseConfig({
        maxConsecutiveWrong: 0,
        requireFirstTradeWin: false,
      }),
      structuralCheck: ({ bar: candidate }) =>
        candidate.low < 96
          ? {
              invalidated: true,
              reason: "structural floor breached",
              metadata: { breachedAt: candidate.low },
            }
          : { invalidated: false },
    });
    expect(result.invalidated).toBe(true);
    expect(result.reason).toBe("structural floor breached");
    expect(result.metadata["invalidation"]).toBe("structural");
    expect(result.metadata["breachedAt"]).toBe(95);
  });

  it("treats flat candles as neither right nor wrong and resets consecutive-wrong streak", () => {
    const result = runThesisLifecycle({
      direction: "up",
      confirmedIndex: 0,
      bars: [
        bar({ open: 100, close: 100 }),
        bar({ open: 100, close: 99 }),
        bar({ open: 99, close: 99 }),
        bar({ open: 99, close: 98 }),
      ],
      lastIndex: 3,
      config: baseConfig({ maxConsecutiveWrong: 2 }),
    });
    expect(result.invalidated).toBe(false);
    expect(result.metadata["wrong"]).toBe(2);
    expect(result.metadata["flat"]).toBe(1);
    expect(result.metadata["consecutiveWrong"]).toBe(1);
  });
});
