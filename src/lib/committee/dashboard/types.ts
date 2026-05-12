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
  readonly trainingOutcomeProfileId: string;
  readonly trainingOutcomeMinAbsMovePct: number;
  readonly rankingMetric: "wilson_low_desc";
  readonly tieBreak: "n_engagements_desc";
};

/**
 * One day-bucket of firings for a single selected candidate (in its
 * target market regime). `t` is midnight-UTC in ms; `u`/`d` are the
 * counts of up/down votes that day, summed across every asset that
 * contributed engagements in this regime.
 *
 * Short field names keep the wire payload small — there's one of these
 * per (selection, day-with-fires).
 */
export type TradeCommitteeFiringBucket = {
  readonly t: number;
  readonly u: number;
  readonly d: number;
};

/**
 * Firings for one selected candidate. Keyed by the same identity as
 * `TradeCommitteeCandidateRow.id` so the chart can group by rank within
 * the active (period, regime) tab.
 */
export type TradeCommitteeFiringSeries = {
  readonly id: string;
  readonly period: TradeCommitteePeriod;
  readonly marketRegime: MarketRegime;
  readonly filterId: string;
  readonly rank: number;
  readonly buckets: readonly TradeCommitteeFiringBucket[];
};

export type TradeCommitteePayload = {
  readonly generatedAtMs: number;
  readonly selectedAtMs: number | null;
  readonly rowCount: number;
  readonly uniqueFilterCount: number;
  readonly selectionConfig: TradeCommitteeSelectionConfig;
  readonly rows: readonly TradeCommitteeCandidateRow[];
  readonly firings: readonly TradeCommitteeFiringSeries[];
  readonly firingsRangeMs: {
    readonly firstMs: number;
    readonly lastMs: number;
  } | null;
};
