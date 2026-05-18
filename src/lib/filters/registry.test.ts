import { evaluateCandidateTradeDecision } from "@alea/lib/filters/evaluateCandidates";
import {
  type CandidateRegistryByMarket,
  registeredCandidates,
  registeredCandidatesByMarket,
  registeredCandidatesForMarket,
  registeredCandidatesForPeriod,
  tradeCandidatesForMarket,
} from "@alea/lib/filters/registry";
import type { RsiDivergenceConfig } from "@alea/lib/filters/rsiDivergence";
import type { FilterCandidate, FilterDecision } from "@alea/lib/filters/types";
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

  it("registers the curated 1h candidates for every tradable asset", () => {
    const assets = ["btc", "eth", "sol", "doge"] as const;
    for (const asset of assets) {
      const candidates = registeredCandidatesForMarket({ asset, period: "1h" });
      const filterIds = new Set(candidates.map((c) => c.filterId));
      expect(filterIds.has("rsi_divergence")).toBe(true);
      expect(filterIds.has("failed_breakout_reversal")).toBe(true);
      const rsiCandidate = candidates.find(
        (c) => c.filterId === "rsi_divergence",
      );
      expect(rsiCandidate?.filterVersion).toBe(6);
      const rsiConfig = rsiCandidate?.config as RsiDivergenceConfig;
      expect(rsiConfig.rsiLength).toBe(21);
      expect(rsiConfig.includeHidden).toBe(true);
      expect(rsiConfig.maxSignalAgeBars).toBe(13);
      expect(rsiConfig.minAgreementScore).toBe(0);
      expect(rsiConfig.maxConsecutiveDisagreements).toBe(1);
    }
  });

  it("keeps the registry typed for different candidate sets by asset", () => {
    const divergentRegistry = {
      "1h": {
        btc: [testCandidate({ id: "one-hour-btc", decision: "up" })],
        eth: [testCandidate({ id: "one-hour-eth", decision: "down" })],
        sol: [testCandidate({ id: "one-hour-sol", decision: "up" })],
        doge: [testCandidate({ id: "one-hour-doge", decision: "down" })],
      },
    } satisfies CandidateRegistryByMarket;

    expect(
      (registeredCandidatesByMarket["1h"].btc ?? []).map(
        (candidate) => candidate.id,
      ),
    ).toEqual(
      registeredCandidatesForMarket({ asset: "btc", period: "1h" }).map(
        (candidate) => candidate.id,
      ),
    );
    expect(
      divergentRegistry["1h"].btc?.map((candidate) => candidate.id),
    ).not.toEqual(
      divergentRegistry["1h"].eth?.map((candidate) => candidate.id),
    );
  });

  it("uses the same direct trade candidates for every local market", () => {
    const periods = ["1h"] as const;
    const assets = ["btc", "eth", "sol", "doge"] as const;

    for (const period of periods) {
      for (const asset of assets) {
        expect(
          tradeCandidatesForMarket({ asset, period }).map(
            (candidate) => candidate.id,
          ),
        ).toEqual(
          registeredCandidatesForMarket({ asset, period }).map(
            (candidate) => candidate.id,
          ),
        );
      }
    }
  });

  it("does not duplicate candidate identities inside a period", () => {
    const ids = registeredCandidatesForPeriod({ period: "1h" }).map(
      (candidate) => candidate.id,
    );

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses the context market when callers do not pass candidates", () => {
    const marketCandidates = tradeCandidatesForMarket({
      asset: "sol",
      period: "1h",
    });
    const decision = evaluateCandidateTradeDecision({
      context: {
        asset: "sol",
        period: "1h",
        targetTsMs: Date.UTC(2026, 0, 1),
        series: {
          pyth: trendingBars({ count: 80 }),
          coinbase: Array.from({ length: 80 }, () => null),
        },
      },
    });

    expect(decision.votes.map((vote) => vote.candidateId)).toEqual(
      marketCandidates.map((candidate) => candidate.id),
    );
  });

  it("acts on a direct trigger without requiring a committee majority", () => {
    const decision = evaluateCandidateTradeDecision({
      context: {
        asset: "btc",
        period: "1h",
        targetTsMs: Date.UTC(2026, 0, 1),
        series: {
          pyth: trendingBars({ count: 80 }),
          coinbase: Array.from({ length: 80 }, () => null),
        },
      },
      candidates: [
        testCandidate({ id: "up-1", decision: "up" }),
        testCandidate({ id: "neutral-1", decision: "neutral" }),
      ],
    });

    expect(decision.prediction).toBe("u");
    expect(decision.up).toBe(1);
    expect(decision.down).toBe(0);
  });

  it("keeps conflicting direct triggers neutral instead of taking a majority", () => {
    const decision = evaluateCandidateTradeDecision({
      context: {
        asset: "btc",
        period: "1h",
        targetTsMs: Date.UTC(2026, 0, 1),
        series: {
          pyth: trendingBars({ count: 80 }),
          coinbase: Array.from({ length: 80 }, () => null),
        },
      },
      candidates: [
        testCandidate({ id: "up-1", decision: "up" }),
        testCandidate({ id: "up-2", decision: "up" }),
        testCandidate({ id: "down-1", decision: "down" }),
      ],
    });

    expect(decision.prediction).toBeNull();
    expect(decision.decision).toBe("neutral");
    expect(decision.summary).toContain("conflict");
    expect(decision.up).toBe(2);
    expect(decision.down).toBe(1);
  });
});

function testCandidate({
  id,
  decision,
}: {
  readonly id: string;
  readonly decision: FilterDecision;
}): FilterCandidate {
  return {
    id,
    filterId: id,
    filterName: id,
    filterVersion: 1,
    description: "Test candidate.",
    sources: [],
    config: {},
    configCanon: "{}",
    configHash: id,
    evaluate: () => ({ decision }),
  };
}

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
