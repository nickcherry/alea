import "@alea/lib/filters/all";

import {
  MAX_COMMITTEE_VOTES_PER_FILTER,
  MIN_COMMITTEE_CONSENSUS_FRACTION,
  MIN_COMMITTEE_VOTES_TO_TRADE,
  TRADE_DECISION_FILTER_TIE_BREAK,
  TRADE_DECISION_HYDRATE_BARS,
  TRADE_DECISION_LEAD_TIME_MS,
  TRADE_DECISION_PERIOD,
} from "@alea/constants/tradeDecision";
import { listCommitteeCandidates } from "@alea/lib/committee/runCommittee";
import type { DatabaseClient } from "@alea/lib/db/types";
import type {
  DryRunDashboardAssetRow,
  DryRunDashboardCumulativeRow,
  DryRunDashboardPayload,
  DryRunDashboardRecentRow,
  DryRunDashboardRegimeAggregate,
  DryRunDashboardSummary,
} from "@alea/lib/dryRun/dashboard/types";

const RECENT_LIMIT = 200;

/**
 * Parse the historic `regime_votes` JSON shape. Two shapes coexist:
 *
 *   - Pre-rewrite (array): `[{regime, winner, up, down, abstain}, …]`
 *     — per-filter-family breakdown. We sum the up/down/abstain
 *     across families to recover the total tally.
 *   - Current object: `{up, down, abstain}` — filter-collapsed tally.
 *
 * The dashboard only needs total engagement (up + down) for the
 * "avg engagement" metric, so collapsing both shapes to totals is
 * sufficient.
 */
function totalsFromVotes(raw: unknown): {
  readonly up: number;
  readonly down: number;
  readonly abstain: number;
} {
  if (raw === null || raw === undefined) {
    return { up: 0, down: 0, abstain: 0 };
  }
  if (Array.isArray(raw)) {
    let up = 0;
    let down = 0;
    let abstain = 0;
    for (const entry of raw) {
      if (typeof entry !== "object" || entry === null) {
        continue;
      }
      const e = entry as { up?: number; down?: number; abstain?: number };
      up += Number(e.up ?? 0);
      down += Number(e.down ?? 0);
      abstain += Number(e.abstain ?? 0);
    }
    return { up, down, abstain };
  }
  if (typeof raw === "object") {
    const o = raw as { up?: number; down?: number; abstain?: number };
    return {
      up: Number(o.up ?? 0),
      down: Number(o.down ?? 0),
      abstain: Number(o.abstain ?? 0),
    };
  }
  return { up: 0, down: 0, abstain: 0 };
}

export async function loadDryRunPayload({
  db,
  now = () => Date.now(),
}: {
  readonly db: DatabaseClient;
  readonly now?: () => number;
}): Promise<DryRunDashboardPayload> {
  const [
    summaryRows,
    assetRows,
    recentRows,
    settledRows,
    regimeRows,
    engagementRows,
  ] = await Promise.all([
    db
      .selectFrom("dry_run_decisions")
      .select(({ fn }) => [
        fn.count<string>("id").as("total"),
        fn.count<string>("id").filterWhere("won", "is not", null).as("settled"),
        fn.count<string>("id").filterWhere("won", "is", null).as("pending"),
        fn.sum<string>("won").filterWhere("won", "is not", null).as("wins"),
        fn
          .count<string>("id")
          .filterWhere("prediction", "=", "u")
          .as("up_total"),
        fn
          .count<string>("id")
          .filterWhere("prediction", "=", "d")
          .as("down_total"),
        fn.sum<string>("won").filterWhere("prediction", "=", "u").as("up_wins"),
        fn
          .sum<string>("won")
          .filterWhere("prediction", "=", "d")
          .as("down_wins"),
        fn.min<string>("decided_at_ms").as("first_at"),
        fn.max<string>("decided_at_ms").as("last_at"),
      ])
      .executeTakeFirstOrThrow(),
    db
      .selectFrom("dry_run_decisions")
      .select(({ fn, eb }) => [
        "asset",
        fn.count<string>("id").filterWhere("won", "is not", null).as("settled"),
        fn.count<string>("id").filterWhere("won", "is", null).as("pending"),
        fn.sum<string>("won").filterWhere("won", "is not", null).as("wins"),
        fn
          .count<string>("id")
          .filterWhere(
            eb.and([eb("won", "is not", null), eb("prediction", "=", "u")]),
          )
          .as("up_settled"),
        fn
          .count<string>("id")
          .filterWhere(
            eb.and([eb("won", "is not", null), eb("prediction", "=", "d")]),
          )
          .as("down_settled"),
      ])
      .groupBy("asset")
      .orderBy("asset", "asc")
      .execute(),
    db
      .selectFrom("dry_run_decisions")
      .select([
        "id",
        "ts_ms",
        "decided_at_ms",
        "asset",
        "prediction",
        "synth_open",
        "actual_close",
        "won",
        "market_regime",
      ])
      .where("won", "is not", null)
      .orderBy("ts_ms", "desc")
      .limit(RECENT_LIMIT)
      .execute(),
    db
      .selectFrom("dry_run_decisions")
      .select(["ts_ms", "won"])
      .where("won", "is not", null)
      .orderBy("ts_ms", "asc")
      .execute(),
    db
      .selectFrom("dry_run_decisions")
      .select(({ fn, eb }) => [
        "market_regime",
        fn.count<string>("id").filterWhere("won", "is not", null).as("calls"),
        fn.sum<string>("won").filterWhere("won", "is not", null).as("wins"),
        fn
          .count<string>("id")
          .filterWhere(
            eb.and([eb("won", "is not", null), eb("prediction", "=", "u")]),
          )
          .as("up_settled"),
        fn
          .count<string>("id")
          .filterWhere(
            eb.and([eb("won", "is not", null), eb("prediction", "=", "d")]),
          )
          .as("down_settled"),
      ])
      .groupBy("market_regime")
      .execute(),
    // Engagement: pull all settled rows' regime_votes for the avg
    // engagement metric. We could push this into SQL with a jsonb
    // accessor but the row count is bounded by overnight volume
    // (~thousands), so a TS pass is fine.
    db
      .selectFrom("dry_run_decisions")
      .select(["regime_votes"])
      .where("won", "is not", null)
      .execute(),
  ]);

  const settledNum = Number(summaryRows.settled);
  const winsNum = Number(summaryRows.wins ?? 0);
  let engagementSum = 0;
  let engagementCount = 0;
  for (const row of engagementRows) {
    const totals = totalsFromVotes(row.regime_votes);
    engagementSum += totals.up + totals.down;
    engagementCount += 1;
  }
  const summary: DryRunDashboardSummary = {
    totalDecisions: Number(summaryRows.total),
    settledDecisions: settledNum,
    pendingDecisions: Number(summaryRows.pending),
    totalWins: winsNum,
    winRate: settledNum === 0 ? null : winsNum / settledNum,
    upDecisions: Number(summaryRows.up_total),
    downDecisions: Number(summaryRows.down_total),
    upWins: Number(summaryRows.up_wins ?? 0),
    downWins: Number(summaryRows.down_wins ?? 0),
    firstDecisionAtMs:
      summaryRows.first_at === null ? null : Number(summaryRows.first_at),
    lastDecisionAtMs:
      summaryRows.last_at === null ? null : Number(summaryRows.last_at),
    candidateCount: listCommitteeCandidates().length,
    avgEngagement:
      engagementCount === 0 ? null : engagementSum / engagementCount,
  };

  const perAsset: DryRunDashboardAssetRow[] = assetRows.map((r) => {
    const settled = Number(r.settled);
    const wins = Number(r.wins ?? 0);
    return {
      asset: r.asset,
      settled,
      pending: Number(r.pending),
      wins,
      winRate: settled === 0 ? null : wins / settled,
      upSettled: Number(r.up_settled ?? 0),
      downSettled: Number(r.down_settled ?? 0),
    };
  });

  // Sort regime aggregates by a stable canonical order so the table
  // doesn't jiggle as new buckets fill. Unknown / null sits last.
  const regimeOrder: readonly (string | null)[] = [
    "low_vol_trending",
    "low_vol_ranging",
    "high_vol_trending",
    "high_vol_ranging",
    null,
  ];
  const perRegime: DryRunDashboardRegimeAggregate[] = regimeRows
    .map((r) => {
      const calls = Number(r.calls);
      const wins = Number(r.wins ?? 0);
      return {
        marketRegime: r.market_regime,
        calls,
        wins,
        winRate: calls === 0 ? null : wins / calls,
        upSettled: Number(r.up_settled ?? 0),
        downSettled: Number(r.down_settled ?? 0),
      };
    })
    .filter((r) => r.calls > 0)
    .sort((a, b) => {
      const ai = regimeOrder.indexOf(a.marketRegime);
      const bi = regimeOrder.indexOf(b.marketRegime);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

  const recent: DryRunDashboardRecentRow[] = recentRows.map((r) => ({
    id: String(r.id),
    tsMs: Number(r.ts_ms),
    decidedAtMs: Number(r.decided_at_ms),
    asset: r.asset,
    prediction: r.prediction,
    synthOpen: r.synth_open,
    actualClose: r.actual_close,
    won: r.won,
    marketRegime: r.market_regime,
  }));

  // Cumulative WR over time — one point per settled decision.
  const cumulative: DryRunDashboardCumulativeRow[] = [];
  let cumSettled = 0;
  let cumWins = 0;
  for (const s of settledRows) {
    cumSettled += 1;
    cumWins += Number(s.won ?? 0);
    cumulative.push({
      tsMs: Number(s.ts_ms),
      settled: cumSettled,
      wins: cumWins,
      cumWinRate: cumWins / cumSettled,
    });
  }

  return {
    generatedAtMs: now(),
    decisionConfig: {
      period: TRADE_DECISION_PERIOD,
      leadTimeMs: TRADE_DECISION_LEAD_TIME_MS,
      hydratedBars: TRADE_DECISION_HYDRATE_BARS,
      maxVotesPerFilter: MAX_COMMITTEE_VOTES_PER_FILTER,
      minVotesToTrade: MIN_COMMITTEE_VOTES_TO_TRADE,
      minConsensusFraction: MIN_COMMITTEE_CONSENSUS_FRACTION,
      filterTieBreak: TRADE_DECISION_FILTER_TIE_BREAK,
    },
    summary,
    perAsset,
    perRegime,
    recent,
    cumulative,
  };
}
