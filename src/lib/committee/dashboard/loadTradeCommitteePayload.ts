import "@alea/lib/filters/all";

import {
  TRAINING_OUTCOME_MIN_ABS_MOVE_PCT,
  TRAINING_OUTCOME_PROFILE_ID,
} from "@alea/constants/training";
import { loadCommitteeFirings } from "@alea/lib/committee/dashboard/loadCommitteeFirings";
import {
  type TradeCommitteeCandidateRow,
  type TradeCommitteeFiringBucket,
  type TradeCommitteeFiringSeries,
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
  const [selectionRows, firingRows] = await Promise.all([
    db
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
      .execute(),
    loadCommitteeFirings({ db }),
  ]);

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
  const selectedAtMs =
    rows.length === 0 ? null : Math.max(...rows.map((r) => r.selectedAtMs));

  const { firings, firingsRangeMs } = buildFiringSeries({
    selectedRows: rows,
    firingRows,
  });

  return {
    generatedAtMs: now(),
    selectedAtMs,
    rowCount: rows.length,
    uniqueFilterCount: filterIds.size,
    selectionConfig: {
      ...rules,
      trainingOutcomeProfileId: TRAINING_OUTCOME_PROFILE_ID,
      trainingOutcomeMinAbsMovePct: TRAINING_OUTCOME_MIN_ABS_MOVE_PCT,
      rankingMetric: "wilson_low_desc",
      tieBreak: "n_engagements_desc",
    },
    rows,
    firings,
    firingsRangeMs,
  };
}

function buildFiringSeries({
  selectedRows,
  firingRows,
}: {
  readonly selectedRows: readonly TradeCommitteeCandidateRow[];
  readonly firingRows: Awaited<ReturnType<typeof loadCommitteeFirings>>;
}): {
  readonly firings: readonly TradeCommitteeFiringSeries[];
  readonly firingsRangeMs: {
    readonly firstMs: number;
    readonly lastMs: number;
  } | null;
} {
  const byId = new Map<string, TradeCommitteeFiringSeries>();
  for (const row of selectedRows) {
    byId.set(row.id, {
      id: row.id,
      period: row.period,
      marketRegime: row.marketRegime,
      filterId: row.filterId,
      rank: row.rank,
      buckets: [],
    });
  }

  const bucketsById = new Map<string, TradeCommitteeFiringBucket[]>();
  let firstMs: number | null = null;
  let lastMs: number | null = null;
  for (const r of firingRows) {
    const period = parsePeriod({ value: r.period });
    const marketRegime = parseMarketRegime({ value: r.market_regime });
    if (period === null || marketRegime === null) {
      continue;
    }
    const id = [
      period,
      marketRegime,
      r.filter_id,
      String(r.filter_version),
      r.config_canon,
    ].join("|");
    if (!byId.has(id)) {
      continue;
    }
    let list = bucketsById.get(id);
    if (list === undefined) {
      list = [];
      bucketsById.set(id, list);
    }
    list.push({ t: r.bucket_ms, u: r.n_up, d: r.n_down });
    if (firstMs === null || r.bucket_ms < firstMs) {
      firstMs = r.bucket_ms;
    }
    if (lastMs === null || r.bucket_ms > lastMs) {
      lastMs = r.bucket_ms;
    }
  }

  for (const [id, list] of bucketsById.entries()) {
    list.sort((a, b) => a.t - b.t);
    const series = byId.get(id);
    if (series !== undefined) {
      byId.set(id, { ...series, buckets: list });
    }
  }

  const firings = Array.from(byId.values());
  const firingsRangeMs =
    firstMs === null || lastMs === null ? null : { firstMs, lastMs };
  return { firings, firingsRangeMs };
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
