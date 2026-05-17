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

  it("registers RSI divergence threshold permutations for every market", () => {
    const periods = ["5m", "15m"] as const;
    const assets = ["btc", "eth", "sol", "doge"] as const;

    for (const period of periods) {
      for (const asset of assets) {
        const candidates = registeredCandidatesForMarket({ asset, period });
        const configs = candidates.map(
          (candidate) => candidate.config as RsiDivergenceConfig,
        );

        expect(candidates).toHaveLength(12);
        expect(
          candidates.every(
            (candidate) =>
              candidate.filterId === "rsi_divergence" &&
              candidate.filterVersion === 6,
          ),
        ).toBe(true);
        expect(configs.every((config) => config.includeHidden)).toBe(true);
        expect(
          configs.every((config) => config.maxSignalAgeBars === 20),
        ).toBe(true);
        expect(
          new Set(configs.map((config) => config.minAgreementScore)),
        ).toEqual(new Set([0, -1, -2, -3]));
        expect(
          new Set(
            configs.map((config) => config.maxConsecutiveDisagreements),
          ),
        ).toEqual(new Set([1, 2, 3]));
        expect(
          new Set(
            configs.map(
              (config) =>
                `${config.minAgreementScore}:${config.maxConsecutiveDisagreements}`,
            ),
          ).size,
        ).toBe(12);
      }
    }
  });

  it("keeps the registry typed for different candidate sets by market", () => {
    const divergentRegistry = {
      "5m": {
        btc: [testCandidate({ id: "five-minute-btc", decision: "up" })],
        eth: [testCandidate({ id: "five-minute-eth", decision: "up" })],
        sol: [testCandidate({ id: "five-minute-sol", decision: "up" })],
        doge: [testCandidate({ id: "five-minute-doge", decision: "up" })],
      },
      "15m": {
        btc: [testCandidate({ id: "fifteen-minute-btc", decision: "down" })],
        eth: [testCandidate({ id: "fifteen-minute-eth", decision: "down" })],
        sol: [testCandidate({ id: "fifteen-minute-sol", decision: "down" })],
        doge: [testCandidate({ id: "fifteen-minute-doge", decision: "down" })],
      },
    } satisfies CandidateRegistryByMarket;

    expect(
      (registeredCandidatesByMarket["5m"].btc ?? []).map(
        (candidate) => candidate.id,
      ),
    ).toEqual(
      registeredCandidatesForMarket({ asset: "btc", period: "5m" }).map(
        (candidate) => candidate.id,
      ),
    );
    expect(
      divergentRegistry["5m"].btc.map((candidate) => candidate.id),
    ).not.toEqual(
      divergentRegistry["15m"].btc.map((candidate) => candidate.id),
    );
  });

  it("uses the same direct trade candidates for every local market", () => {
    const periods = ["5m", "15m"] as const;
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
    const ids = registeredCandidatesForPeriod({ period: "5m" }).map(
      (candidate) => candidate.id,
    );

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses the context market when callers do not pass candidates", () => {
    const marketCandidates = tradeCandidatesForMarket({
      asset: "sol",
      period: "15m",
    });
    const decision = evaluateCandidateTradeDecision({
      context: {
        asset: "sol",
        period: "15m",
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
        period: "5m",
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
        period: "5m",
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
