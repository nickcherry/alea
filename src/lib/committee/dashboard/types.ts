import type { CommitteeSelectionRules } from "@alea/lib/committee/selection/types";
import type { FilterFamily } from "@alea/lib/filters/types";
import type { MarketRegime } from "@alea/lib/regime/types";
import type { CandleTimeframe } from "@alea/types/candles";

export type TradeCommitteePeriod = Extract<CandleTimeframe, "5m" | "15m">;

export type TradeCommitteeCandidateRow = {
  readonly id: string;
  readonly marketRegime: MarketRegime;
  readonly period: TradeCommitteePeriod;
  readonly filterId: string;
  readonly filterVersion: number;
  readonly filterFamily: FilterFamily | null;
  readonly filterDescription: string | null;
  readonly configCanon: string;
  readonly rank: number;
  readonly nEngagements: number;
  readonly nWins: number;
  readonly winRate: number;
  readonly wilsonLow: number;
  readonly worstQuarterWinRate: number | null;
  readonly selectedAtMs: number;
};

export type TradeCommitteeSelectionConfig = CommitteeSelectionRules & {
  readonly trainingProfileId: string;
  readonly trainingOutcomeProfileId: string;
  readonly trainingOutcomeMinAbsMovePct: number;
  readonly trainingWindowStartPolicy: "earliest_available_candle";
  readonly trainingWindowEndInclusiveMs: number;
  readonly rankingMetric: "wilson_low_desc";
  readonly tieBreak: "n_engagements_desc";
};

export type TradeCommitteePayload = {
  readonly generatedAtMs: number;
  readonly selectedAtMs: number | null;
  readonly rowCount: number;
  readonly uniqueFilterCount: number;
  readonly selectionConfig: TradeCommitteeSelectionConfig;
  readonly rows: readonly TradeCommitteeCandidateRow[];
};
