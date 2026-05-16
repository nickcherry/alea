import { evaluateCandidateTradeDecision } from "@alea/lib/filters/evaluateCandidates";
import { registeredCandidates } from "@alea/lib/filters/registry";
import type { MarketBar } from "@alea/lib/marketSeries/types";
import { describe, expect, it } from "bun:test";

describe("registeredCandidates", () => {
  it("has stable filter/version/config identities", () => {
    const ids = registeredCandidates.map((candidate) => candidate.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.includes("@v"))).toBe(true);
    expect(
      registeredCandidates.every((candidate) => candidate.sources.length > 0),
    ).toBe(true);
  });

  it("aggregates candidate votes into an actionable majority", () => {
    const decision = evaluateCandidateTradeDecision({
      context: {
        asset: "btc",
        period: "5m",
        targetTsMs: Date.UTC(2026, 0, 1),
        series: {
          pyth: trendingBars({ count: 80 }),
          coinbase: Array.from({ length: 80 }, () => null),
        },
      },
      candidates: registeredCandidates.slice(0, 2),
    });

    expect(decision.prediction).toBe("u");
    expect(decision.up).toBe(2);
    expect(decision.down).toBe(0);
  });
});

function trendingBars({ count }: { readonly count: number }): MarketBar[] {
  return Array.from({ length: count }, (_, i) => {
    const open = 100 + i;
    const close = open + 0.8;
    return {
      openTimeMs: Date.UTC(2026, 0, 1, 0, i),
      open,
      high: close + 0.2,
      low: open - 0.2,
      close,
      volume: 0,
    };
  });
}
