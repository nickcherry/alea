import {
  DRY_RUN_MARKET_DISCOVERY_LEAD_MS,
  DRY_RUN_ORDER_LIMIT_PRICE_POLICY,
  DRY_RUN_ORDER_MAX_QUOTE_AGE_MS,
  DRY_RUN_ORDER_PLACEMENT_DELAY_MS,
  DRY_RUN_ORDER_PRICE_WINDOW_CENTS,
} from "@alea/constants/dryRun";
import {
  TRADE_DECISION_PRIMARY_PERIOD,
  TRADE_DECISION_SUPPORTED_PERIODS,
  tradeDecisionLeadTimeMs,
  tradeDecisionHydrateBars,
} from "@alea/constants/tradeDecision";
import type { DatabaseClient } from "@alea/lib/db/types";
import type {
  DryRunDashboardAssetRow,
  DryRunDashboardCumulativeRow,
  DryRunDashboardPayload,
  DryRunDashboardPeriodSlice,
  DryRunDashboardRecentRow,
  DryRunDashboardSummary,
} from "@alea/lib/dryRun/dashboard/types";

const RECENT_LIMIT = 200;

type DryRunDecisionRow = {
  readonly id: string | number;
  readonly ts_ms: string | number;
  readonly decided_at_ms: string | number;
  readonly asset: string;
  readonly period: string;
  readonly prediction: "u" | "d";
  readonly synth_open: number;
  readonly actual_open: number | null;
  readonly actual_close: number | null;
  readonly won: number | null;
  readonly order_status: string;
  readonly order_observed_price: number | null;
  readonly order_limit_price: number | null;
  readonly order_confidence: number | null;
  readonly order_fill_price: number | null;
  readonly decision_duration_ms: number | null;
  readonly order_fill_latency_ms: number | null;
};

export async function loadDryRunPayload({
  db,
  now = () => Date.now(),
}: {
  readonly db: DatabaseClient;
  readonly now?: () => number;
}): Promise<DryRunDashboardPayload> {
  // One pull of every decision, then bucket in TS. Volume is bounded by
  // overnight dry-run throughput; splitting by period in TS keeps
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
      "actual_open",
      "actual_close",
      "won",
      "order_status",
      "order_observed_price",
      "order_limit_price",
      "order_confidence",
      "order_fill_price",
      "decision_duration_ms",
      "order_fill_latency_ms",
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
      actualOpen: r.actual_open,
      actualClose: r.actual_close,
      won: r.won,
      orderStatus: r.order_status,
      orderObservedPrice: r.order_observed_price,
      orderLimitPrice: r.order_limit_price,
      orderConfidence: r.order_confidence,
      orderFillPrice: r.order_fill_price,
      decisionDurationMs: r.decision_duration_ms,
      orderFillLatencyMs: r.order_fill_latency_ms,
    }));

  const byPeriod: { [period: string]: DryRunDashboardPeriodSlice } = {};
  for (const period of TRADE_DECISION_SUPPORTED_PERIODS) {
    byPeriod[period] = buildPeriodSlice({
      rows: allRows.filter((r) => r.period === period),
    });
  }

  return {
    generatedAtMs: now(),
    decisionConfig: {
      period: TRADE_DECISION_PRIMARY_PERIOD,
      supportedPeriods: TRADE_DECISION_SUPPORTED_PERIODS,
      leadTimeByPeriodMs: Object.fromEntries(
        TRADE_DECISION_SUPPORTED_PERIODS.map((period) => [
          period,
          tradeDecisionLeadTimeMs({ period }),
        ]),
      ),
      decisionSource: "openai_chart",
      hydratedBarsByPeriod: Object.fromEntries(
        TRADE_DECISION_SUPPORTED_PERIODS.map((period) => [
          period,
          tradeDecisionHydrateBars({ period }),
        ]),
      ),
      orderPlacementDelayMs: DRY_RUN_ORDER_PLACEMENT_DELAY_MS,
      orderLimitPricePolicy: DRY_RUN_ORDER_LIMIT_PRICE_POLICY,
      orderPriceWindowCents: DRY_RUN_ORDER_PRICE_WINDOW_CENTS,
      orderMaxQuoteAgeMs: DRY_RUN_ORDER_MAX_QUOTE_AGE_MS,
      marketDiscoveryLeadMs: DRY_RUN_MARKET_DISCOVERY_LEAD_MS,
    },
    byPeriod,
    recent,
  };
}

function buildPeriodSlice({
  rows,
}: {
  readonly rows: readonly DryRunDecisionRow[];
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

  type AssetAcc = {
    settled: number;
    pending: number;
    wins: number;
    upSettled: number;
    downSettled: number;
  };
  const byAsset = new Map<string, AssetAcc>();
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

  return { summary, perAsset, cumulative };
}
