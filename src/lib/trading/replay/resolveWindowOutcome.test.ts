import { resolveWindowOutcome } from "@alea/lib/trading/replay/resolveWindowOutcome";
import type { ReplayChainlinkRefPriceEvent } from "@alea/lib/trading/replay/types";
import { describe, expect, it } from "bun:test";

const WINDOW_START = 1_777_995_000_000; // 2026-05-05T15:30:00Z
const WINDOW_END = WINDOW_START + 5 * 60 * 1_000;

function chainlinkAt({
  tsMs,
  value,
}: {
  readonly tsMs: number;
  readonly value: number;
}): ReplayChainlinkRefPriceEvent {
  return {
    id: `cl-${tsMs}`,
    tsMs,
    receivedMs: tsMs,
    asset: "btc",
    marketRef: "btc/usd",
    source: "polymarket-chainlink",
    kind: "reference-price",
    value,
    tsExchangeMs: tsMs,
  };
}

describe("resolveWindowOutcome", () => {
  it("declares 'up' when chainlink close exceeds chainlink line", () => {
    const result = resolveWindowOutcome({
      windowStartMs: WINDOW_START,
      chainlinkEvents: [
        chainlinkAt({ tsMs: WINDOW_START - 1_000, value: 80_000 }),
        chainlinkAt({ tsMs: WINDOW_START + 30_000, value: 80_500 }),
        chainlinkAt({ tsMs: WINDOW_END - 1_000, value: 81_000 }),
      ],
      polymarketResolution: null,
    });
    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;
    expect(result.outcome.winningSide).toBe("up");
    expect(result.outcome.chainlinkLine).toBe(80_000);
    expect(result.outcome.chainlinkClose).toBe(81_000);
    expect(result.outcome.flags).toEqual([]);
  });

  it("flags fallback when no chainlink event exists before windowStart", () => {
    const result = resolveWindowOutcome({
      windowStartMs: WINDOW_START,
      chainlinkEvents: [
        chainlinkAt({ tsMs: WINDOW_START + 5_000, value: 80_000 }),
        chainlinkAt({ tsMs: WINDOW_END - 1_000, value: 79_500 }),
      ],
      polymarketResolution: null,
    });
    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;
    expect(result.outcome.winningSide).toBe("down");
    expect(result.outcome.flags).toContain("line-after-window-start");
  });

  it("flags chainlink/polymarket disagreement", () => {
    const result = resolveWindowOutcome({
      windowStartMs: WINDOW_START,
      chainlinkEvents: [
        chainlinkAt({ tsMs: WINDOW_START - 1_000, value: 80_000 }),
        chainlinkAt({ tsMs: WINDOW_END - 1_000, value: 79_500 }),
      ],
      polymarketResolution: {
        winningSide: "up",
        winningOutcomeRef: "0xabc",
        resolvedAtMs: WINDOW_END + 90_000,
      },
    });
    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;
    expect(result.outcome.winningSide).toBe("down");
    expect(result.outcome.disagreementWithPolymarket).toBe(true);
  });

  it("returns null disagreement when polymarket resolution is missing", () => {
    const result = resolveWindowOutcome({
      windowStartMs: WINDOW_START,
      chainlinkEvents: [
        chainlinkAt({ tsMs: WINDOW_START - 1_000, value: 80_000 }),
        chainlinkAt({ tsMs: WINDOW_END - 1_000, value: 79_500 }),
      ],
      polymarketResolution: null,
    });
    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;
    expect(result.outcome.disagreementWithPolymarket).toBeNull();
  });

  it("errors when no chainlink coverage", () => {
    const result = resolveWindowOutcome({
      windowStartMs: WINDOW_START,
      chainlinkEvents: [],
      polymarketResolution: null,
    });
    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.error.kind).toBe("no-events");
  });
});
