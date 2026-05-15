import {
  isTradeDecisionMarketRegimeAllowed,
  TRADE_DECISION_ALLOWED_MARKET_REGIMES,
} from "@alea/constants/tradeDecision";
import {
  candidateRosterKey,
  type CommitteeRoster,
  rosterBucketKey,
} from "@alea/lib/committee/selection/loadCommitteeRoster";
import type { AlignedBarSeries } from "@alea/lib/filters/barSeries";
import type { Candidate, FilterBar } from "@alea/lib/filters/types";
import { evaluateTradeDecision } from "@alea/lib/tradeDecision/evaluateTradeDecision";
import { describe, expect, it } from "bun:test";

describe("trade decision regime policy", () => {
  it("allows every classified regime", () => {
    expect(TRADE_DECISION_ALLOWED_MARKET_REGIMES).toEqual([
      "low_vol_trending",
      "low_vol_ranging",
      "high_vol_trending",
      "high_vol_ranging",
    ]);
    expect(isTradeDecisionMarketRegimeAllowed("low_vol_trending")).toBe(true);
    expect(isTradeDecisionMarketRegimeAllowed("low_vol_ranging")).toBe(true);
    expect(isTradeDecisionMarketRegimeAllowed("high_vol_trending")).toBe(true);
    expect(isTradeDecisionMarketRegimeAllowed("high_vol_ranging")).toBe(true);
    expect(isTradeDecisionMarketRegimeAllowed(null)).toBe(false);
  });

  it("does not discard high-volatility roster buckets before evaluation", () => {
    const candidate = fakeCandidate();
    const key = candidateRosterKey({
      filterId: candidate.filterId,
      filterVersion: candidate.version,
      configCanon: candidate.configCanon,
    });
    const roster: CommitteeRoster = {
      selectedAtMs: 1,
      byBucket: new Map([
        [
          rosterBucketKey({
            asset: "btc",
            marketRegime: "high_vol_ranging",
            period: "5m",
          }),
          [{ key, winRate: 0.9, nEngagements: 100, rank: 1 }],
        ],
      ]),
    };

    const evaluated = evaluateTradeDecision({
      asset: "btc",
      period: "5m",
      series: aligned(highVolBars()),
      roster,
      candidatesByKey: new Map([[key, candidate]]),
    });

    expect(evaluated).toEqual({
      prediction: null,
      marketRegime: "high_vol_ranging",
      rosterSize: 1,
      up: 0,
      down: 0,
      abstain: 0,
      orderConfidence: null,
    });
  });
});

function fakeCandidate(): Candidate {
  return {
    filterId: "test_would_trade_if_allowed",
    version: 1,
    config: {},
    configCanon: "{}",
    candidateHash: "test_would_trade_if_allowed|1|{}",
  };
}

function aligned(pyth: readonly FilterBar[]): AlignedBarSeries {
  return { pyth, coinbase: pyth.map(() => null) };
}

function highVolBars(): readonly FilterBar[] {
  const bars: FilterBar[] = [];
  let price = 100;
  for (let i = 0; i < 100; i += 1) {
    const close = price + (i % 2 === 0 ? 0.02 : -0.02);
    bars.push(bar({ i, open: price, close }));
    price = close;
  }
  for (let i = 100; i < 120; i += 1) {
    const close = price + (i % 2 === 0 ? 8 : -8);
    bars.push(bar({ i, open: price, close }));
    price = close;
  }
  return bars;
}

function bar({
  i,
  open,
  close,
}: {
  readonly i: number;
  readonly open: number;
  readonly close: number;
}): FilterBar {
  return {
    openTimeMs: i * 5 * 60 * 1000,
    open,
    high: Math.max(open, close) + 0.01,
    low: Math.min(open, close) - 0.01,
    close,
    volume: 0,
  };
}
