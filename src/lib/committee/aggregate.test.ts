import { aggregateCommittee } from "@alea/lib/committee/aggregate";
import type { CandidateVote } from "@alea/lib/committee/types";
import type { FilterPrediction } from "@alea/lib/filters/types";
import { describe, expect, it } from "bun:test";

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
