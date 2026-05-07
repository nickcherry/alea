import { assetValues } from "@alea/constants/assets";
import type {
  TradingPerformanceChartPoint,
  TradingPerformancePayload,
  TradingPerformancePositionResult,
  TradingPerformancePositionRow,
  TradingPerformancePositionStatus,
} from "@alea/lib/trading/performance/types";

export type TradingPerformanceInputPosition = {
  readonly conditionId: string;
  readonly tokenId: string;
  readonly oppositeTokenId: string | null;
  readonly title: string;
  readonly slug: string | null;
  readonly outcome: string;
  readonly size: number;
  readonly avgPrice: number;
  readonly currentPrice: number;
  readonly initialValueUsd: number;
  readonly currentValueUsd: number;
  readonly cashPnlUsd: number;
  readonly realizedPnlUsd: number;
  readonly endDateMs: number | null;
  readonly redeemable: boolean;
};

export function buildTradingPerformancePayload({
  walletAddress,
  generatedAtMs,
  positions,
}: {
  readonly walletAddress: string;
  readonly generatedAtMs: number;
  readonly positions: readonly TradingPerformanceInputPosition[];
}): TradingPerformancePayload {
  const rows = positions
    .map(buildPositionRow)
    .sort((a, b) => (b.endDateMs ?? 0) - (a.endDateMs ?? 0) || a.title.localeCompare(b.title));
  const chart = buildChart({ rows });

  const lifetimePnlUsd = sum(rows.map((row) => row.cashPnlUsd));
  const totalInvestedUsd = sum(rows.map((row) => row.initialValueUsd));
  const currentValueUsd = sum(rows.map((row) => row.currentValueUsd));

  return {
    command: "trading:performance",
    generatedAtMs,
    walletAddress,
    source: {
      positions:
        "Polymarket data-api /positions?user=<funder> (cashPnl is mark-to-market, includes realized + unrealized)",
    },
    summary: {
      walletAddress,
      positionCount: rows.length,
      openPositionCount: rows.filter((row) => row.status === "open").length,
      redeemablePositionCount: rows.filter((row) => row.status === "redeemable").length,
      winningPositionCount: rows.filter((row) => row.result === "win").length,
      losingPositionCount: rows.filter((row) => row.result === "loss").length,
      flatPositionCount: rows.filter((row) => row.result === "flat").length,
      lifetimePnlUsd,
      totalInvestedUsd,
      currentValueUsd,
    },
    chart,
    positions: rows,
  };
}

function buildPositionRow(
  position: TradingPerformanceInputPosition,
): TradingPerformancePositionRow {
  const status: TradingPerformancePositionStatus = position.redeemable
    ? "redeemable"
    : "open";
  return {
    conditionId: position.conditionId,
    tokenId: position.tokenId,
    oppositeTokenId: position.oppositeTokenId,
    symbol: inferSymbol({ slug: position.slug, title: position.title }),
    title: position.title,
    slug: position.slug,
    outcome: position.outcome,
    size: position.size,
    avgPrice: position.avgPrice,
    currentPrice: position.currentPrice,
    initialValueUsd: position.initialValueUsd,
    currentValueUsd: position.currentValueUsd,
    cashPnlUsd: position.cashPnlUsd,
    realizedPnlUsd: position.realizedPnlUsd,
    endDateMs: position.endDateMs,
    status,
    result: resultFromPosition({
      cashPnlUsd: position.cashPnlUsd,
      status,
    }),
  };
}

/**
 * Cumulative-PnL series ordered by settlement date. Open positions
 * fall back to a synthetic late timestamp so they cluster at the
 * right edge of the chart — the operator still sees the running
 * total, but unrealized entries don't pretend to have a real
 * settlement date.
 */
function buildChart({
  rows,
}: {
  readonly rows: readonly TradingPerformancePositionRow[];
}): TradingPerformanceChartPoint[] {
  const ordered = [...rows].sort(
    (a, b) =>
      (a.endDateMs ?? Number.MAX_SAFE_INTEGER) -
        (b.endDateMs ?? Number.MAX_SAFE_INTEGER) ||
      a.conditionId.localeCompare(b.conditionId),
  );
  let cumulative = 0;
  const points: TradingPerformanceChartPoint[] = [];
  for (const row of ordered) {
    cumulative += row.cashPnlUsd;
    points.push({
      conditionId: row.conditionId,
      symbol: row.symbol,
      title: row.title,
      orderedAtMs: row.endDateMs ?? 0,
      positionPnlUsd: row.cashPnlUsd,
      cumulativePnlUsd: cumulative,
    });
  }
  return points;
}

function resultFromPosition({
  cashPnlUsd,
  status,
}: {
  readonly cashPnlUsd: number;
  readonly status: TradingPerformancePositionStatus;
}): TradingPerformancePositionResult {
  if (status === "open") {
    return "open";
  }
  if (cashPnlUsd > 0) {
    return "win";
  }
  if (cashPnlUsd < 0) {
    return "loss";
  }
  return "flat";
}

function inferSymbol({
  slug,
  title,
}: {
  readonly slug: string | null;
  readonly title: string;
}): string {
  const lower = (slug ?? "").toLowerCase();
  for (const asset of assetValues) {
    if (
      lower === asset ||
      lower.startsWith(`${asset}-`) ||
      lower.includes(`-${asset}-`) ||
      lower.includes(`${asset}up`) ||
      lower.includes(`${asset}-updown`)
    ) {
      return asset.toUpperCase();
    }
  }
  const haystack = title.toUpperCase();
  for (const asset of assetValues) {
    const upper = asset.toUpperCase();
    if (new RegExp(`\\b${upper}\\b`).test(haystack)) {
      return upper;
    }
  }
  return "POLY";
}

function sum(values: readonly number[]): number {
  return values.reduce((acc, value) => acc + value, 0);
}
