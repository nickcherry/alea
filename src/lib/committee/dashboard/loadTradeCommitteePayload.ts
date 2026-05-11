import "@alea/lib/filters/all";

import {
  TRAINING_OUTCOME_MIN_ABS_MOVE_PCT,
  TRAINING_OUTCOME_PROFILE_ID,
} from "@alea/constants/training";
import {
  type TradeCommitteeBucketSummary,
  type TradeCommitteeCandidateRow,
  type TradeCommitteePayload,
  type TradeCommitteePeriod,
} from "@alea/lib/committee/dashboard/types";
import {
  type CommitteeSelectionRules,
  DEFAULT_COMMITTEE_SELECTION_RULES,
} from "@alea/lib/committee/selection/types";
import type { DatabaseClient } from "@alea/lib/db/types";
import { getFilter } from "@alea/lib/filters/registry";
import type { MarketRegime } from "@alea/lib/regime/types";

const PERIOD_ORDER: readonly TradeCommitteePeriod[] = ["5m", "15m"];
const REGIME_ORDER: readonly MarketRegime[] = [
  "low_vol_ranging",
  "low_vol_trending",
  "high_vol_ranging",
  "high_vol_trending",
];

export async function loadTradeCommitteePayload({
  db,
  now = () => Date.now(),
  rules = DEFAULT_COMMITTEE_SELECTION_RULES,
}: {
  readonly db: DatabaseClient;
  readonly now?: () => number;
  readonly rules?: CommitteeSelectionRules;
}): Promise<TradeCommitteePayload> {
  const selectionRows = await db
    .selectFrom("committee_selections")
    .select([
      "market_regime",
      "period",
      "filter_id",
      "filter_version",
      "config_canon",
      "rank",
      "n_engagements",
      "n_wins",
      "win_rate",
      "wilson_low",
      "worst_quarter_wr",
      "selected_at_ms",
    ])
    .execute();

  const rows: TradeCommitteeCandidateRow[] = [];
  for (const r of selectionRows) {
    const period = parsePeriod({ value: r.period });
    const marketRegime = parseMarketRegime({ value: r.market_regime });
    if (period === null || marketRegime === null) {
      continue;
    }
    const filter = getFilter(r.filter_id)?.filter;
    rows.push({
      id: [
        period,
        marketRegime,
        r.filter_id,
        String(r.filter_version),
        r.config_canon,
      ].join("|"),
      marketRegime,
      period,
      filterId: r.filter_id,
      filterVersion: r.filter_version,
      filterFamily: filter?.family ?? null,
      filterDescription: filter?.description ?? null,
      configCanon: r.config_canon,
      rank: r.rank,
      nEngagements: r.n_engagements,
      nWins: r.n_wins,
      winRate: r.win_rate,
      wilsonLow: r.wilson_low,
      worstQuarterWinRate: r.worst_quarter_wr,
      selectedAtMs: Number(r.selected_at_ms),
    });
  }
  rows.sort(compareCommitteeRows);

  const filterIds = new Set(rows.map((r) => r.filterId));
  const buckets = buildBucketSummaries({ rows });
  const selectedAtMs =
    rows.length === 0 ? null : Math.max(...rows.map((r) => r.selectedAtMs));

  return {
    generatedAtMs: now(),
    selectedAtMs,
    rowCount: rows.length,
    uniqueFilterCount: filterIds.size,
    activeBucketCount: buckets.filter((b) => b.candidateCount > 0).length,
    selectionConfig: {
      ...rules,
      trainingOutcomeProfileId: TRAINING_OUTCOME_PROFILE_ID,
      trainingOutcomeMinAbsMovePct: TRAINING_OUTCOME_MIN_ABS_MOVE_PCT,
      rankingMetric: "wilson_low_desc",
      tieBreak: "n_engagements_desc",
    },
    rows,
    buckets,
  };
}

function parsePeriod({
  value,
}: {
  readonly value: string;
}): TradeCommitteePeriod | null {
  return value === "5m" || value === "15m" ? value : null;
}

function parseMarketRegime({
  value,
}: {
  readonly value: string;
}): MarketRegime | null {
  switch (value) {
    case "low_vol_ranging":
    case "low_vol_trending":
    case "high_vol_ranging":
    case "high_vol_trending":
      return value;
  }
  return null;
}

function buildBucketSummaries({
  rows,
}: {
  readonly rows: readonly TradeCommitteeCandidateRow[];
}): readonly TradeCommitteeBucketSummary[] {
  const summaries: TradeCommitteeBucketSummary[] = [];
  for (const period of PERIOD_ORDER) {
    for (const marketRegime of REGIME_ORDER) {
      const bucketRows = rows.filter(
        (r) => r.period === period && r.marketRegime === marketRegime,
      );
      const top = bucketRows.find((r) => r.rank === 1) ?? bucketRows[0];
      summaries.push({
        period,
        marketRegime,
        candidateCount: bucketRows.length,
        topFilterId: top?.filterId ?? null,
        topWinRate: top?.winRate ?? null,
        selectedAtMs:
          bucketRows.length === 0
            ? null
            : Math.max(...bucketRows.map((r) => r.selectedAtMs)),
      });
    }
  }
  return summaries;
}

function compareCommitteeRows(
  a: TradeCommitteeCandidateRow,
  b: TradeCommitteeCandidateRow,
): number {
  const periodDelta =
    PERIOD_ORDER.indexOf(a.period) - PERIOD_ORDER.indexOf(b.period);
  if (periodDelta !== 0) {
    return periodDelta;
  }
  const regimeDelta =
    REGIME_ORDER.indexOf(a.marketRegime) - REGIME_ORDER.indexOf(b.marketRegime);
  if (regimeDelta !== 0) {
    return regimeDelta;
  }
  return a.rank - b.rank;
}
