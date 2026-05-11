import { selectCommitteeCandidates } from "@alea/lib/committee/selection/selectCandidates";
import type {
  CandidateRegimeStats,
  CommitteeSelectionRules,
} from "@alea/lib/committee/selection/types";
import { describe, expect, it } from "bun:test";

const RULES: CommitteeSelectionRules = {
  minEngagements: 20,
  minAggregateWinRate: 0.53,
  minWorstQuarterWinRate: 0.5,
  worstQuarterMinEngagements: 10,
  topN: 3,
};

function stats(
  partial: Partial<CandidateRegimeStats> & {
    filterId: string;
    nEngagements: number;
    winRate: number;
    wilsonLow: number;
  },
): CandidateRegimeStats {
  return {
    filterVersion: 1,
    configCanon: `${partial.filterId}-default`,
    period: "5m",
    marketRegime: "low_vol_ranging",
    nWins: Math.round(partial.nEngagements * partial.winRate),
    worstQuarterWinRate: 0.6,
    ...partial,
  };
}

describe("selectCommitteeCandidates", () => {
  it("drops candidates below the engagement minimum", () => {
    const result = selectCommitteeCandidates({
      stats: [
        stats({
          filterId: "a",
          nEngagements: 19,
          winRate: 0.9,
          wilsonLow: 0.7,
        }),
      ],
      rules: RULES,
    });
    expect(result).toEqual([]);
  });

  it("drops candidates below the aggregate WR floor", () => {
    const result = selectCommitteeCandidates({
      stats: [
        stats({
          filterId: "a",
          nEngagements: 500,
          winRate: 0.52,
          wilsonLow: 0.5,
        }),
      ],
      rules: RULES,
    });
    expect(result).toEqual([]);
  });

  it("drops candidates whose worst quarter is below floor", () => {
    const result = selectCommitteeCandidates({
      stats: [
        stats({
          filterId: "a",
          nEngagements: 500,
          winRate: 0.6,
          wilsonLow: 0.55,
          worstQuarterWinRate: 0.42,
        }),
      ],
      rules: RULES,
    });
    expect(result).toEqual([]);
  });

  it("admits candidates whose worst-quarter score is null", () => {
    const result = selectCommitteeCandidates({
      stats: [
        stats({
          filterId: "a",
          nEngagements: 30,
          winRate: 0.65,
          wilsonLow: 0.51,
          worstQuarterWinRate: null,
        }),
      ],
      rules: RULES,
    });
    expect(result.map((r) => r.filterId)).toEqual(["a"]);
    expect(result[0]!.rank).toBe(1);
  });

  it("ranks by Wilson lower bound desc, ties broken by nEngagements desc", () => {
    const result = selectCommitteeCandidates({
      stats: [
        stats({
          filterId: "small_lucky",
          nEngagements: 25,
          winRate: 0.8,
          wilsonLow: 0.55,
        }),
        stats({
          filterId: "big_solid",
          nEngagements: 1000,
          winRate: 0.6,
          wilsonLow: 0.57,
        }),
        stats({
          filterId: "tie_smaller",
          nEngagements: 100,
          winRate: 0.6,
          wilsonLow: 0.55,
        }),
      ],
      rules: RULES,
    });
    expect(result.map((r) => r.filterId)).toEqual([
      "big_solid",
      "tie_smaller",
      "small_lucky",
    ]);
  });

  it("caps each (regime, period) bucket at topN independently", () => {
    const five = (regime: string) =>
      Array.from({ length: 5 }, (_, i) =>
        stats({
          filterId: `${regime}_${i}`,
          marketRegime: regime,
          nEngagements: 200 - i,
          winRate: 0.6,
          wilsonLow: 0.6 - i * 0.001,
        }),
      );
    const result = selectCommitteeCandidates({
      stats: [...five("low_vol_ranging"), ...five("high_vol_ranging")],
      rules: RULES,
    });
    const byRegime = new Map<string, number>();
    for (const r of result) {
      byRegime.set(r.marketRegime, (byRegime.get(r.marketRegime) ?? 0) + 1);
    }
    expect(byRegime.get("low_vol_ranging")).toBe(3);
    expect(byRegime.get("high_vol_ranging")).toBe(3);
  });
});
