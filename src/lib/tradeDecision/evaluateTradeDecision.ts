import type { TradeDecisionPeriod } from "@alea/constants/tradeDecision";
import { selectEffectiveCommitteeVotes } from "@alea/lib/committee/aggregate";
import { evaluateCommittee } from "@alea/lib/committee/runCommittee";
import {
  type CommitteeRoster,
  rosterBucketKey,
} from "@alea/lib/committee/selection/loadCommitteeRoster";
import type { CommitteeCandidate } from "@alea/lib/committee/types";
import type { AlignedBarSeries } from "@alea/lib/filters/barSeries";
import type { Candidate, FilterPrediction } from "@alea/lib/filters/types";
import { classifyMarketRegime } from "@alea/lib/regime/classify";
import type { MarketRegime } from "@alea/lib/regime/types";
import type { Asset } from "@alea/types/assets";

export type EvaluatedTradeDecision = {
  readonly prediction: "u" | "d" | null;
  readonly marketRegime: MarketRegime | null;
  readonly rosterSize: number;
  readonly up: number;
  readonly down: number;
  readonly abstain: number;
  readonly orderConfidence: number | null;
};

export function evaluateTradeDecision({
  asset,
  period,
  series,
  roster,
  candidatesByKey,
}: {
  readonly asset: Asset;
  readonly period: TradeDecisionPeriod;
  readonly series: AlignedBarSeries;
  readonly roster: CommitteeRoster;
  readonly candidatesByKey: ReadonlyMap<string, Candidate>;
}): EvaluatedTradeDecision {
  // The market-regime classifier reads Pyth OHLC only — keep its
  // input on the canonical Pyth timeline regardless of whether
  // individual committee members use Coinbase data.
  const marketRegime = classifyMarketRegime({ bars: series.pyth });
  const rosterCandidates: CommitteeCandidate[] = [];
  if (marketRegime !== null) {
    const bucket = roster.byBucket.get(
      rosterBucketKey({
        asset,
        marketRegime,
        period,
      }),
    );
    if (bucket !== undefined) {
      for (const member of bucket) {
        const cand = candidatesByKey.get(member.key);
        if (cand !== undefined) {
          rosterCandidates.push({
            candidate: cand,
            selection: {
              winRate: member.winRate,
              nEngagements: member.nEngagements,
              rank: member.rank,
            },
          });
        }
      }
    }
  }
  const { decision, votes } =
    marketRegime === null || rosterCandidates.length === 0
      ? {
          decision: { prediction: null, up: 0, down: 0, abstain: 0 } as const,
          votes: [],
        }
      : evaluateCommittee({
          decisionContext: {
            asset,
            marketRegime,
            period,
          },
          series,
          candidates: rosterCandidates,
        });
  const effectiveVotes = selectEffectiveCommitteeVotes({ votes });
  const orderConfidence = averageWinningVoteConfidence({
    prediction: decision.prediction,
    winRates: effectiveVotes
      .filter((vote) => vote.prediction === decision.prediction)
      .map((vote) => vote.selection.winRate),
  });

  return {
    prediction:
      decision.prediction === null
        ? null
        : decision.prediction === "up"
          ? "u"
          : "d",
    marketRegime,
    rosterSize: rosterCandidates.length,
    up: decision.up,
    down: decision.down,
    abstain: decision.abstain,
    orderConfidence,
  };
}

function averageWinningVoteConfidence({
  prediction,
  winRates,
}: {
  readonly prediction: FilterPrediction;
  readonly winRates: readonly (number | null)[];
}): number | null {
  if (prediction === null) {
    return null;
  }
  const usable = winRates.filter(
    (value): value is number =>
      value !== null && Number.isFinite(value) && value >= 0 && value <= 1,
  );
  if (usable.length === 0) {
    return null;
  }
  return usable.reduce((sum, value) => sum + value, 0) / usable.length;
}
