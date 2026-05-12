import "@alea/lib/filters/all";

import {
  DRY_RUN_ORDER_LIMIT_OFFSET_CENTS,
  DRY_RUN_ORDER_PLACEMENT_DELAY_MS,
  DRY_RUN_ORDER_PRICE_WINDOW_CENTS,
} from "@alea/constants/dryRun";
import {
  MAX_COMMITTEE_VOTES_PER_FILTER,
  MIN_COMMITTEE_CONSENSUS_FRACTION,
  MIN_COMMITTEE_VOTES_TO_TRADE,
  TRADE_DECISION_FILTER_TIE_BREAK,
  TRADE_DECISION_HYDRATE_BARS,
  TRADE_DECISION_LEAD_TIME_MS,
  TRADE_DECISION_PERIOD,
  TRADE_DECISION_SUPPORTED_PERIODS,
} from "@alea/constants/tradeDecision";
import { listCommitteeCandidates } from "@alea/lib/committee/runCommittee";
import type { DatabaseClient } from "@alea/lib/db/types";
import type {
  DryRunDashboardAssetRow,
  DryRunDashboardCumulativeRow,
  DryRunDashboardPayload,
  DryRunDashboardPeriodSlice,
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

type DryRunDecisionRow = {
  readonly id: string | number;
  readonly ts_ms: string | number;
  readonly decided_at_ms: string | number;
  readonly asset: string;
  readonly period: string;
  readonly prediction: "u" | "d";
  readonly synth_open: number;
  readonly actual_close: number | null;
  readonly won: number | null;
  readonly market_regime: string | null;
  readonly regime_votes: unknown;
  readonly order_status: string;
  readonly order_observed_price: number | null;
  readonly order_limit_price: number | null;
  readonly order_confidence: number | null;
  readonly order_fill_price: number | null;
};

export async function loadDryRunPayload({
  db,
  now = () => Date.now(),
}: {
  readonly db: DatabaseClient;
  readonly now?: () => number;
}): Promise<DryRunDashboardPayload> {
  // One pull of every decision, then bucket in TS. Volume is bounded by
  // overnight committee throughput; splitting by period in TS keeps
  // the SQL simple and gives us per-period slices + a globally-sorted
  // recent feed from a single scan.
  const allRowsRaw = await db
    .selectFrom("dry_run_decisions")
    .select([
      "id",
      "ts_ms",
      "decided_at_ms",
      "asset",
      "period",
      "prediction",
      "synth_open",
      "actual_close",
      "won",
      "market_regime",
      "regime_votes",
      "order_status",
      "order_observed_price",
      "order_limit_price",
      "order_confidence",
      "order_fill_price",
    ])
    .orderBy("ts_ms", "desc")
    .execute();

  const allRows = allRowsRaw as readonly DryRunDecisionRow[];

  const recent: DryRunDashboardRecentRow[] = allRows
    .slice(0, RECENT_LIMIT)
    .map((r) => ({
      id: String(r.id),
      tsMs: Number(r.ts_ms),
      decidedAtMs: Number(r.decided_at_ms),
      asset: r.asset,
      period: r.period,
      prediction: r.prediction,
      synthOpen: r.synth_open,
      actualClose: r.actual_close,
      won: r.won,
      marketRegime: r.market_regime,
      orderStatus: r.order_status,
      orderObservedPrice: r.order_observed_price,
      orderLimitPrice: r.order_limit_price,
      orderConfidence: r.order_confidence,
      orderFillPrice: r.order_fill_price,
    }));

  const candidateCount = listCommitteeCandidates().length;
  const byPeriod: { [period: string]: DryRunDashboardPeriodSlice } = {};
  for (const period of TRADE_DECISION_SUPPORTED_PERIODS) {
    byPeriod[period] = buildPeriodSlice({
      rows: allRows.filter((r) => r.period === period),
      candidateCount,
    });
  }

  return {
    generatedAtMs: now(),
    decisionConfig: {
      period: TRADE_DECISION_PERIOD,
      supportedPeriods: TRADE_DECISION_SUPPORTED_PERIODS,
      leadTimeMs: TRADE_DECISION_LEAD_TIME_MS,
      hydratedBars: TRADE_DECISION_HYDRATE_BARS,
      maxVotesPerFilter: MAX_COMMITTEE_VOTES_PER_FILTER,
      minVotesToTrade: MIN_COMMITTEE_VOTES_TO_TRADE,
      minConsensusFraction: MIN_COMMITTEE_CONSENSUS_FRACTION,
      filterTieBreak: TRADE_DECISION_FILTER_TIE_BREAK,
      orderPlacementDelayMs: DRY_RUN_ORDER_PLACEMENT_DELAY_MS,
      orderPriceWindowCents: DRY_RUN_ORDER_PRICE_WINDOW_CENTS,
      orderLimitOffsetCents: DRY_RUN_ORDER_LIMIT_OFFSET_CENTS,
    },
    byPeriod,
    recent,
  };
}

function buildPeriodSlice({
  rows,
  candidateCount,
}: {
  readonly rows: readonly DryRunDecisionRow[];
  readonly candidateCount: number;
}): DryRunDashboardPeriodSlice {
  let total = 0;
  let settled = 0;
  let pending = 0;
  let wins = 0;
  let upTotal = 0;
  let downTotal = 0;
  let upWins = 0;
  let downWins = 0;
  let firstAt: number | null = null;
  let lastAt: number | null = null;
  let engagementSum = 0;
  let engagementCount = 0;

  type AssetAcc = {
    settled: number;
    pending: number;
    wins: number;
    upSettled: number;
    downSettled: number;
  };
  type RegimeAcc = {
    calls: number;
    wins: number;
    upSettled: number;
    downSettled: number;
  };
  const byAsset = new Map<string, AssetAcc>();
  const byRegime = new Map<string | null, RegimeAcc>();
  const settledForChart: { tsMs: number; won: number }[] = [];

  for (const r of rows) {
    total += 1;
    const decidedAt = Number(r.decided_at_ms);
    if (firstAt === null || decidedAt < firstAt) {
      firstAt = decidedAt;
    }
    if (lastAt === null || decidedAt > lastAt) {
      lastAt = decidedAt;
    }

    const isSettled = r.won !== null;
    const wonNum = Number(r.won ?? 0);

    if (isSettled) {
      settled += 1;
      wins += wonNum;
      const totals = totalsFromVotes(r.regime_votes);
      engagementSum += totals.up + totals.down;
      engagementCount += 1;
      settledForChart.push({ tsMs: Number(r.ts_ms), won: wonNum });
    } else {
      pending += 1;
    }
    if (r.prediction === "u") {
      upTotal += 1;
      if (isSettled) {
        upWins += wonNum;
      }
    } else if (r.prediction === "d") {
      downTotal += 1;
      if (isSettled) {
        downWins += wonNum;
      }
    }

    const assetAcc = byAsset.get(r.asset) ?? {
      settled: 0,
      pending: 0,
      wins: 0,
      upSettled: 0,
      downSettled: 0,
    };
    if (isSettled) {
      assetAcc.settled += 1;
      assetAcc.wins += wonNum;
      if (r.prediction === "u") {
        assetAcc.upSettled += 1;
      } else if (r.prediction === "d") {
        assetAcc.downSettled += 1;
      }
    } else {
      assetAcc.pending += 1;
    }
    byAsset.set(r.asset, assetAcc);

    if (isSettled) {
      const regimeAcc = byRegime.get(r.market_regime) ?? {
        calls: 0,
        wins: 0,
        upSettled: 0,
        downSettled: 0,
      };
      regimeAcc.calls += 1;
      regimeAcc.wins += wonNum;
      if (r.prediction === "u") {
        regimeAcc.upSettled += 1;
      } else if (r.prediction === "d") {
        regimeAcc.downSettled += 1;
      }
      byRegime.set(r.market_regime, regimeAcc);
    }
  }

  const summary: DryRunDashboardSummary = {
    totalDecisions: total,
    settledDecisions: settled,
    pendingDecisions: pending,
    totalWins: wins,
    winRate: settled === 0 ? null : wins / settled,
    upDecisions: upTotal,
    downDecisions: downTotal,
    upWins,
    downWins,
    firstDecisionAtMs: firstAt,
    lastDecisionAtMs: lastAt,
    candidateCount,
    avgEngagement:
      engagementCount === 0 ? null : engagementSum / engagementCount,
  };

  const perAsset: DryRunDashboardAssetRow[] = Array.from(byAsset.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([asset, acc]) => ({
      asset,
      settled: acc.settled,
      pending: acc.pending,
      wins: acc.wins,
      winRate: acc.settled === 0 ? null : acc.wins / acc.settled,
      upSettled: acc.upSettled,
      downSettled: acc.downSettled,
    }));

  const regimeOrder: readonly (string | null)[] = [
    "low_vol_trending",
    "low_vol_ranging",
    "high_vol_trending",
    "high_vol_ranging",
    null,
  ];
  const perRegime: DryRunDashboardRegimeAggregate[] = Array.from(
    byRegime.entries(),
  )
    .map(([marketRegime, acc]) => ({
      marketRegime,
      calls: acc.calls,
      wins: acc.wins,
      winRate: acc.calls === 0 ? null : acc.wins / acc.calls,
      upSettled: acc.upSettled,
      downSettled: acc.downSettled,
    }))
    .filter((r) => r.calls > 0)
    .sort((a, b) => {
      const ai = regimeOrder.indexOf(a.marketRegime);
      const bi = regimeOrder.indexOf(b.marketRegime);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

  settledForChart.sort((a, b) => a.tsMs - b.tsMs);
  const cumulative: DryRunDashboardCumulativeRow[] = [];
  let cumSettled = 0;
  let cumWins = 0;
  for (const s of settledForChart) {
    cumSettled += 1;
    cumWins += s.won;
    cumulative.push({
      tsMs: s.tsMs,
      settled: cumSettled,
      wins: cumWins,
      cumWinRate: cumWins / cumSettled,
    });
  }

  return { summary, perAsset, perRegime, cumulative };
}
