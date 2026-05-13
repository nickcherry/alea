import { aggregateCommittee } from "@alea/lib/committee/aggregate";
import type { CandidateVote } from "@alea/lib/committee/types";
import type { FilterPrediction } from "@alea/lib/filters/types";
import { describe, expect, it } from "bun:test";

const shapeV2Rules = {
  maxVotesPerFilter: 1,
  minVotesToTrade: 2,
  minConsensusFraction: 0.5,
  policyId: "shape-v2" as const,
};

const shapeV3Rules = {
  maxVotesPerFilter: 1,
  minVotesToTrade: 2,
  minConsensusFraction: 0.5,
  policyId: "shape-v3" as const,
};

const shapeV4Rules = {
  maxVotesPerFilter: 1,
  minVotesToTrade: 2,
  minConsensusFraction: 0.5,
  policyId: "shape-v4" as const,
};

function vote({
  filterId,
  configCanon = "{}",
  prediction,
  winRate,
  nEngagements = 100,
  rank = 1,
}: {
  readonly filterId: string;
  readonly configCanon?: string;
  readonly prediction: FilterPrediction;
  readonly winRate: number | null;
  readonly nEngagements?: number;
  readonly rank?: number;
}): CandidateVote {
  return {
    candidate: {
      filterId,
      version: 1,
      config: {},
      configCanon,
      candidateHash: `${filterId}|${configCanon}`,
    },
    prediction,
    selection: { winRate, nEngagements, rank },
  };
}

describe("aggregateCommittee", () => {
  it("allows at most one active vote per filter and keeps the highest-win-rate config", () => {
    const decision = aggregateCommittee({
      votes: [
        vote({
          filterId: "rsi_mean_rev",
          configCanon: '{"len":7}',
          prediction: "up",
          winRate: 0.54,
          rank: 2,
        }),
        vote({
          filterId: "rsi_mean_rev",
          configCanon: '{"len":14}',
          prediction: "down",
          winRate: 0.61,
          rank: 1,
        }),
        vote({
          filterId: "stochastic_mean_rev",
          prediction: "up",
          winRate: 0.58,
        }),
      ],
    });

    expect(decision).toEqual({
      prediction: null,
      up: 1,
      down: 1,
      abstain: 0,
    });
  });

  it("does not let an abstaining high-win-rate config block an engaged config for the same filter", () => {
    const decision = aggregateCommittee({
      rules: {
        maxVotesPerFilter: 1,
        minVotesToTrade: 1,
        minConsensusFraction: 0.5,
      },
      votes: [
        vote({
          filterId: "rsi_mean_rev",
          configCanon: '{"len":14}',
          prediction: null,
          winRate: 0.65,
          rank: 1,
        }),
        vote({
          filterId: "rsi_mean_rev",
          configCanon: '{"len":7}',
          prediction: "up",
          winRate: 0.55,
          rank: 2,
        }),
      ],
    });

    expect(decision).toEqual({
      prediction: "up",
      up: 1,
      down: 0,
      abstain: 0,
    });
  });

  it("requires the default minimum vote count before producing a trade", () => {
    const oneVote = aggregateCommittee({
      votes: [
        vote({
          filterId: "rsi_mean_rev",
          prediction: "up",
          winRate: 0.55,
        }),
      ],
    });

    expect(oneVote).toEqual({
      prediction: null,
      up: 1,
      down: 0,
      abstain: 0,
    });

    const twoVotes = aggregateCommittee({
      votes: [
        vote({
          filterId: "rsi_mean_rev",
          prediction: "up",
          winRate: 0.55,
        }),
        vote({
          filterId: "stochastic_mean_rev",
          prediction: "up",
          winRate: 0.56,
        }),
      ],
    });

    expect(twoVotes).toEqual({
      prediction: "up",
      up: 2,
      down: 0,
      abstain: 0,
    });
  });

  it("applies the shape-v2 contextual policy when asset, period, and regime are provided", () => {
    const ethHighVolOneVote = aggregateCommittee({
      context: {
        asset: "eth",
        period: "5m",
        marketRegime: "high_vol_trending",
      },
      rules: shapeV2Rules,
      votes: [
        vote({
          filterId: "rsi_mean_rev",
          prediction: "up",
          winRate: 0.55,
        }),
      ],
    });

    expect(ethHighVolOneVote.prediction).toBe("up");

    const solFiveLowVolOneVote = aggregateCommittee({
      context: {
        asset: "sol",
        period: "5m",
        marketRegime: "low_vol_trending",
      },
      rules: shapeV2Rules,
      votes: [
        vote({
          filterId: "rsi_mean_rev",
          prediction: "down",
          winRate: 0.55,
        }),
      ],
    });

    expect(solFiveLowVolOneVote.prediction).toBe("down");

    const btcFifteenLowVolOneVote = aggregateCommittee({
      context: {
        asset: "btc",
        period: "15m",
        marketRegime: "low_vol_trending",
      },
      rules: shapeV2Rules,
      votes: [
        vote({
          filterId: "rsi_mean_rev",
          prediction: "down",
          winRate: 0.55,
        }),
      ],
    });

    expect(btcFifteenLowVolOneVote.prediction).toBe("down");

    const dogeFifteenLowVolOneVote = aggregateCommittee({
      context: {
        asset: "doge",
        period: "15m",
        marketRegime: "low_vol_trending",
      },
      rules: shapeV2Rules,
      votes: [
        vote({
          filterId: "rsi_mean_rev",
          prediction: "up",
          winRate: 0.55,
        }),
      ],
    });

    expect(dogeFifteenLowVolOneVote.prediction).toBeNull();

    const xrpHighVolTwoVotes = aggregateCommittee({
      context: {
        asset: "xrp",
        period: "5m",
        marketRegime: "high_vol_trending",
      },
      rules: shapeV2Rules,
      votes: [
        vote({
          filterId: "rsi_mean_rev",
          prediction: "up",
          winRate: 0.55,
        }),
        vote({
          filterId: "stochastic_mean_rev",
          prediction: "up",
          winRate: 0.56,
        }),
      ],
    });

    expect(xrpHighVolTwoVotes.prediction).toBeNull();

    const highVolFifteenMinute = aggregateCommittee({
      context: {
        asset: "btc",
        period: "15m",
        marketRegime: "high_vol_trending",
      },
      rules: shapeV2Rules,
      votes: [
        vote({
          filterId: "rsi_mean_rev",
          prediction: "up",
          winRate: 0.55,
        }),
        vote({
          filterId: "stochastic_mean_rev",
          prediction: "up",
          winRate: 0.56,
        }),
      ],
    });

    expect(highVolFifteenMinute.prediction).toBeNull();
  });

  it("applies the shape-v3 group policy", () => {
    const btcHighVolFifteenMinute = aggregateCommittee({
      context: {
        asset: "btc",
        period: "15m",
        marketRegime: "high_vol_trending",
      },
      rules: shapeV3Rules,
      votes: [
        vote({
          filterId: "rsi_mean_rev",
          prediction: "up",
          winRate: 0.55,
        }),
        vote({
          filterId: "stochastic_mean_rev",
          prediction: "up",
          winRate: 0.56,
        }),
      ],
    });

    expect(btcHighVolFifteenMinute.prediction).toBe("up");

    const lowRankXrpHighVolFifteenMinute = aggregateCommittee({
      context: {
        asset: "xrp",
        period: "15m",
        marketRegime: "high_vol_trending",
      },
      rules: shapeV3Rules,
      votes: [
        vote({
          filterId: "rsi_mean_rev",
          prediction: "down",
          winRate: 0.55,
          rank: 5,
        }),
      ],
    });

    expect(lowRankXrpHighVolFifteenMinute.prediction).toBeNull();

    const highRankXrpHighVolFifteenMinute = aggregateCommittee({
      context: {
        asset: "xrp",
        period: "15m",
        marketRegime: "high_vol_trending",
      },
      rules: shapeV3Rules,
      votes: [
        vote({
          filterId: "rsi_mean_rev",
          prediction: "down",
          winRate: 0.55,
          rank: 4,
        }),
      ],
    });

    expect(highRankXrpHighVolFifteenMinute.prediction).toBe("down");

    const twoVoteXrpLowVolRanging = aggregateCommittee({
      context: {
        asset: "xrp",
        period: "5m",
        marketRegime: "low_vol_ranging",
      },
      rules: shapeV3Rules,
      votes: [
        vote({
          filterId: "rsi_mean_rev",
          prediction: "up",
          winRate: 0.55,
        }),
        vote({
          filterId: "stochastic_mean_rev",
          prediction: "up",
          winRate: 0.56,
        }),
      ],
    });

    expect(twoVoteXrpLowVolRanging.prediction).toBeNull();

    const threeVoteXrpLowVolRanging = aggregateCommittee({
      context: {
        asset: "xrp",
        period: "5m",
        marketRegime: "low_vol_ranging",
      },
      rules: shapeV3Rules,
      votes: [
        vote({
          filterId: "rsi_mean_rev",
          prediction: "up",
          winRate: 0.55,
        }),
        vote({
          filterId: "stochastic_mean_rev",
          prediction: "up",
          winRate: 0.56,
        }),
        vote({
          filterId: "cci_mean_rev",
          prediction: "up",
          winRate: 0.57,
        }),
      ],
    });

    expect(threeVoteXrpLowVolRanging.prediction).toBe("up");
  });

  it("applies the shape-v4 group policy", () => {
    const lowRankBtcHighVolFifteenMinute = aggregateCommittee({
      context: {
        asset: "btc",
        period: "15m",
        marketRegime: "high_vol_trending",
      },
      rules: shapeV4Rules,
      votes: [
        vote({
          filterId: "rsi_mean_rev",
          prediction: "up",
          rank: 9,
          winRate: 0.55,
        }),
      ],
    });

    expect(lowRankBtcHighVolFifteenMinute.prediction).toBeNull();

    const highRankBtcHighVolFifteenMinute = aggregateCommittee({
      context: {
        asset: "btc",
        period: "15m",
        marketRegime: "high_vol_trending",
      },
      rules: shapeV4Rules,
      votes: [
        vote({
          filterId: "rsi_mean_rev",
          prediction: "up",
          rank: 8,
          winRate: 0.55,
        }),
      ],
    });

    expect(highRankBtcHighVolFifteenMinute.prediction).toBe("up");

    const xrpFifteenLowVolTrending = aggregateCommittee({
      context: {
        asset: "xrp",
        period: "15m",
        marketRegime: "low_vol_trending",
      },
      rules: shapeV4Rules,
      votes: [
        vote({
          filterId: "rsi_mean_rev",
          prediction: "down",
          winRate: 0.55,
        }),
        vote({
          filterId: "stochastic_mean_rev",
          prediction: "down",
          winRate: 0.56,
        }),
        vote({
          filterId: "cci_mean_rev",
          prediction: "down",
          winRate: 0.57,
        }),
      ],
    });

    expect(xrpFifteenLowVolTrending.prediction).toBeNull();

    const xrpFiveLowVolRanging = aggregateCommittee({
      context: {
        asset: "xrp",
        period: "5m",
        marketRegime: "low_vol_ranging",
      },
      rules: shapeV4Rules,
      votes: [
        vote({
          filterId: "rsi_mean_rev",
          prediction: "up",
          rank: 8,
          winRate: 0.55,
        }),
      ],
    });

    expect(xrpFiveLowVolRanging.prediction).toBe("up");
  });

  it("applies the default shape-v5 group policy", () => {
    const dogeFiveLowVolTrendingOneVote = aggregateCommittee({
      context: {
        asset: "doge",
        period: "5m",
        marketRegime: "low_vol_trending",
      },
      votes: [
        vote({
          filterId: "rsi_mean_rev",
          prediction: "up",
          rank: 4,
          winRate: 0.55,
        }),
      ],
    });

    expect(dogeFiveLowVolTrendingOneVote.prediction).toBeNull();

    const dogeFiveLowVolTrendingTwoVotes = aggregateCommittee({
      context: {
        asset: "doge",
        period: "5m",
        marketRegime: "low_vol_trending",
      },
      votes: [
        vote({
          filterId: "rsi_mean_rev",
          prediction: "up",
          rank: 4,
          winRate: 0.55,
        }),
        vote({
          filterId: "stochastic_mean_rev",
          prediction: "up",
          rank: 8,
          winRate: 0.56,
        }),
      ],
    });

    expect(dogeFiveLowVolTrendingTwoVotes.prediction).toBe("up");

    const xrpFifteenLowVolTrending = aggregateCommittee({
      context: {
        asset: "xrp",
        period: "15m",
        marketRegime: "low_vol_trending",
      },
      votes: [
        vote({
          filterId: "rsi_mean_rev",
          prediction: "down",
          winRate: 0.55,
        }),
      ],
    });

    expect(xrpFifteenLowVolTrending.prediction).toBe("down");
  });

  it("counts abstain once per filter when no config engages", () => {
    const decision = aggregateCommittee({
      votes: [
        vote({
          filterId: "rsi_mean_rev",
          configCanon: '{"len":14}',
          prediction: null,
          winRate: 0.65,
        }),
        vote({
          filterId: "rsi_mean_rev",
          configCanon: '{"len":7}',
          prediction: null,
          winRate: 0.55,
        }),
        vote({
          filterId: "stochastic_mean_rev",
          prediction: null,
          winRate: 0.58,
        }),
      ],
    });

    expect(decision).toEqual({
      prediction: null,
      up: 0,
      down: 0,
      abstain: 2,
    });
  });
});
