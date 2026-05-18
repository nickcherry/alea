import { assetValues } from "@alea/constants/assets";
import type {
  TradingPerformanceChartPoint,
  TradingPerformanceMarketResult,
  TradingPerformanceMarketRole,
  TradingPerformanceMarketRow,
  TradingPerformanceMarketStatus,
  TradingPerformancePayload,
} from "@alea/lib/trading/performance/types";

/**
 * Per-market trader role, sourced from CLOB /trades. Optional because
 * the `trading:hydrate-lifetime-pnl` checkpoint path doesn't fetch
 * /trades — only the dashboard build does.
 *
 * Fees are NOT in this map. /trades reports `fee_rate_bps: "0"` even
 * for taker orders that were charged the venue's standard ~700bps,
 * so we derive the true fee from /activity instead (it ships
 * cashflow ground truth: `usdcSize - size*price` is the fee).
 */
export type TradeRolesByConditionId = ReadonlyMap<
  string,
  { readonly role: TradingPerformanceMarketRole }
>;

/**
 * Activity event from Polymarket's data-api `/activity` endpoint —
 * one record per fill, redemption, split, or merge. Cashflow direction
 * is encoded in `kind` (and, for trades, `side`).
 */
export type TradingPerformanceInputActivity = {
  readonly kind: "TRADE" | "REDEEM" | "MAKER_REBATE" | "SPLIT" | "MERGE";
  readonly side: "BUY" | "SELL" | null;
  readonly conditionId: string | null;
  readonly title: string | null;
  readonly slug: string | null;
  readonly outcome: string | null;
  /** USDC that actually moved on this event — fee-inclusive. */
  readonly usdcSize: number;
  /** Shares moved on this event (TRADE / REDEEM only). */
  readonly size: number;
  /** Fill price for TRADE events; 0 for non-trade events. */
  readonly price: number;
  readonly timestampMs: number;
};

/**
 * Open or redeemable position record from data-api `/positions`.
 * Used to mark currently-held markets to current price (or report the
 * still-redeemable losing balance).
 */
export type TradingPerformanceInputPosition = {
  readonly conditionId: string;
  readonly title: string | null;
  readonly slug: string | null;
  readonly outcome: string | null;
  readonly size: number;
  readonly currentPrice: number;
  readonly currentValueUsd: number;
  readonly endDateMs: number | null;
  readonly redeemable: boolean;
};

/**
 * Builds the lifetime trading-performance payload by combining
 * Polymarket activity (the cashflow ledger) with current positions
 * (mark-to-market for unsettled markets). The headline lifetime PnL
 * is `returned - invested + currentValue + rebates`, which matches
 * the change in wallet equity attributable to trading.
 */
export function buildTradingPerformancePayload({
  walletAddress,
  generatedAtMs,
  activity,
  positions,
  tradeRolesByConditionId,
}: {
  readonly walletAddress: string;
  readonly generatedAtMs: number;
  readonly activity: readonly TradingPerformanceInputActivity[];
  readonly positions: readonly TradingPerformanceInputPosition[];
  readonly tradeRolesByConditionId?: TradeRolesByConditionId;
}): TradingPerformancePayload {
  const positionsByConditionId = new Map(
    positions.map((position) => [position.conditionId, position] as const),
  );

  // Group market-scoped activity (TRADE / REDEEM / SPLIT / MERGE) by
  // conditionId. MAKER_REBATE rolls up into a separate scalar — it's
  // venue-paid revenue not tied to a single market.
  const grouped = new Map<
    string,
    {
      conditionId: string;
      title: string | null;
      slug: string | null;
      outcome: string | null;
      invested: number;
      returned: number;
      feeUsd: number;
      boughtSize: number;
      latestActivityMs: number;
    }
  >();
  let makerRebateUsd = 0;

  for (const event of activity) {
    if (event.kind === "MAKER_REBATE") {
      makerRebateUsd += event.usdcSize;
      continue;
    }
    if (event.conditionId === null) {
      continue;
    }
    const sign = directionForActivity({ kind: event.kind, side: event.side });
    if (sign === 0) {
      continue;
    }
    const existing = grouped.get(event.conditionId) ?? {
      conditionId: event.conditionId,
      title: event.title,
      slug: event.slug,
      outcome: event.outcome,
      invested: 0,
      returned: 0,
      feeUsd: 0,
      boughtSize: 0,
      latestActivityMs: 0,
    };
    if (sign < 0) {
      existing.invested += event.usdcSize;
    } else {
      existing.returned += event.usdcSize;
    }
    if (event.kind === "TRADE" && event.side === "BUY") {
      existing.boughtSize += event.size;
    }
    existing.feeUsd += deriveFeeUsd({ event });
    if (event.timestampMs > existing.latestActivityMs) {
      existing.latestActivityMs = event.timestampMs;
    }
    if (existing.title === null && event.title !== null) {
      existing.title = event.title;
    }
    if (existing.slug === null && event.slug !== null) {
      existing.slug = event.slug;
    }
    if (existing.outcome === null && event.outcome !== null) {
      existing.outcome = event.outcome;
    }
    grouped.set(event.conditionId, existing);
  }

  // Markets we hold currently but have no activity for? Shouldn't
  // happen in practice (every position came from a BUY), but defend
  // against the API surfacing one and ensure it appears in the table.
  for (const position of positions) {
    if (!grouped.has(position.conditionId)) {
      grouped.set(position.conditionId, {
        conditionId: position.conditionId,
        title: position.title,
        slug: position.slug,
        outcome: position.outcome,
        invested: 0,
        returned: 0,
        feeUsd: 0,
        boughtSize: 0,
        latestActivityMs: 0,
      });
    }
  }

  const rows: TradingPerformanceMarketRow[] = [];
  for (const m of grouped.values()) {
    const position = positionsByConditionId.get(m.conditionId) ?? null;
    const currentValueUsd = position?.currentValueUsd ?? 0;
    const currentSize = position?.size ?? 0;
    const currentPrice = position?.currentPrice ?? 0;
    const status = positionStatus({
      hasPosition: position !== null,
      redeemable: position?.redeemable ?? false,
      currentValueUsd,
    });
    const equityPnlUsd = m.returned + currentValueUsd - m.invested;
    const realizedPnlUsd = status === "open" ? null : m.returned - m.invested;
    const avgEntryPrice = m.boughtSize > 0 ? m.invested / m.boughtSize : null;
    const role = tradeRolesByConditionId?.get(m.conditionId);
    rows.push({
      conditionId: m.conditionId,
      symbol: inferSymbol({ slug: m.slug, title: m.title ?? "" }),
      title: m.title ?? "Unknown Polymarket market",
      slug: m.slug,
      outcome: position?.outcome ?? m.outcome,
      endDateMs: position?.endDateMs ?? null,
      lastActivityAtMs: m.latestActivityMs,
      investedUsd: m.invested,
      returnedUsd: m.returned,
      currentValueUsd,
      currentSize,
      currentPrice,
      boughtSize: m.boughtSize,
      avgEntryPrice,
      realizedPnlUsd,
      pnlUsd: equityPnlUsd,
      status,
      result: resultFromRow({ pnlUsd: equityPnlUsd, status }),
      traderRole: role?.role ?? null,
      feeUsd: m.feeUsd,
    });
  }

  rows.sort(
    (a, b) =>
      b.lastActivityAtMs - a.lastActivityAtMs ||
      a.conditionId.localeCompare(b.conditionId),
  );

  const chart = buildChart({ rows });
  const totalInvestedUsd = sum(rows.map((r) => r.investedUsd));
  const totalReturnedUsd = sum(rows.map((r) => r.returnedUsd));
  const currentValueUsd = sum(rows.map((r) => r.currentValueUsd));
  const totalFeesUsd = sum(rows.map((r) => r.feeUsd));
  const realizedPnlUsd =
    sum(rows.map((r) => r.realizedPnlUsd ?? 0)) + makerRebateUsd;
  const openMtmPnlUsd = sum(
    rows.filter((r) => r.status === "open").map((r) => r.pnlUsd),
  );
  const lifetimePnlUsd =
    totalReturnedUsd + currentValueUsd - totalInvestedUsd + makerRebateUsd;

  return {
    command: "trading:performance",
    generatedAtMs,
    walletAddress,
    source: {
      activity:
        "Polymarket data-api /activity?user=<funder> (BUY / REDEEM / SELL / MAKER_REBATE cashflows)",
      positions:
        "Polymarket data-api /positions?user=<funder> (mark-to-market for currently-held positions)",
    },
    summary: {
      walletAddress,
      marketCount: rows.length,
      openPositionCount: rows.filter((r) => r.status === "open").length,
      redeemablePositionCount: rows.filter((r) => r.status === "redeemable")
        .length,
      winningMarketCount: rows.filter((r) => r.result === "win").length,
      losingMarketCount: rows.filter((r) => r.result === "loss").length,
      flatMarketCount: rows.filter((r) => r.result === "flat").length,
      lifetimePnlUsd,
      realizedPnlUsd,
      openMtmPnlUsd,
      totalInvestedUsd,
      totalReturnedUsd,
      currentValueUsd,
      makerRebateUsd,
      totalFeesUsd,
    },
    chart,
    markets: rows,
  };
}

/**
 * `+1` = USDC into the wallet, `-1` = USDC out, `0` = ignore. SPLIT
 * burns USDC into a YES+NO token pair (cash out); MERGE collapses a
 * pair back into USDC (cash in). REDEEM is winnings hitting the
 * wallet at settlement. TRADE BUY/SELL is the obvious pair.
 */
function directionForActivity({
  kind,
  side,
}: {
  readonly kind: TradingPerformanceInputActivity["kind"];
  readonly side: TradingPerformanceInputActivity["side"];
}): -1 | 0 | 1 {
  switch (kind) {
    case "TRADE":
      if (side === "BUY") {
        return -1;
      }
      if (side === "SELL") {
        return 1;
      }
      return 0;
    case "REDEEM":
    case "MERGE":
      return 1;
    case "SPLIT":
      return -1;
    case "MAKER_REBATE":
      return 0; // counted as a separate scalar
  }
}

/**
 * Per-event fee in USD, derived from the cashflow gap. Polymarket's
 * /trades endpoint reports `fee_rate_bps: "0"` even on taker fills
 * that were charged the venue's standard ~700bps, so we ignore it
 * and instead infer the fee from `usdcSize − size*price` on the
 * /activity TRADE record (the only event type that carries a real
 * fill price). REDEEM / SPLIT / MERGE are zero-fee venue events.
 *
 * For BUY: `usdcSize > size*price` → trader paid more than no-fee
 * cost; the gap is the fee.
 * For SELL: `usdcSize < size*price` → trader received less than
 * no-fee proceeds; the gap is the fee.
 *
 * `abs()` collapses both directions into a single positive scalar.
 * Sub-cent gaps (rounding noise) are clamped to zero so a
 * fee-free venue config doesn't show a $0.001 fee per trade.
 */
function deriveFeeUsd({
  event,
}: {
  readonly event: TradingPerformanceInputActivity;
}): number {
  if (event.kind !== "TRADE") {
    return 0;
  }
  if (!Number.isFinite(event.size) || !Number.isFinite(event.price)) {
    return 0;
  }
  const noFeeNotional = event.size * event.price;
  const fee = Math.abs(event.usdcSize - noFeeNotional);
  if (fee < 0.005) {
    return 0;
  }
  return fee;
}

/**
 * Redeemable-position current values at or below this (in USD) are
 * dust — the losing side of a resolved market, worth effectively zero
 * but still sitting on /positions because we never burned the worthless
 * tokens. Treat them as closed so the row reads as a plain win/loss
 * instead of "redeemable win/loss". Real unclaimed winnings ($payout
 * × shares) are well above the threshold and stay flagged as redeemable.
 */
const REDEEMABLE_DUST_THRESHOLD_USD = 0.01;

function positionStatus({
  hasPosition,
  redeemable,
  currentValueUsd,
}: {
  readonly hasPosition: boolean;
  readonly redeemable: boolean;
  readonly currentValueUsd: number;
}): TradingPerformanceMarketStatus {
  if (!hasPosition) {
    return "closed";
  }
  if (redeemable && currentValueUsd < REDEEMABLE_DUST_THRESHOLD_USD) {
    return "closed";
  }
  return redeemable ? "redeemable" : "open";
}

function resultFromRow({
  pnlUsd,
  status,
}: {
  readonly pnlUsd: number;
  readonly status: TradingPerformanceMarketStatus;
}): TradingPerformanceMarketResult {
  if (status === "open") {
    return "open";
  }
  if (pnlUsd > 0.005) {
    return "win";
  }
  if (pnlUsd < -0.005) {
    return "loss";
  }
  return "flat";
}

function buildChart({
  rows,
}: {
  readonly rows: readonly TradingPerformanceMarketRow[];
}): TradingPerformanceChartPoint[] {
  // Order settled events by latest market activity so the cumulative
  // line tracks realized PnL through time. Open positions stay out of
  // this chart because their PnL is still mark-to-market and can move
  // until resolution/redemption.
  const ordered = rows
    .filter((r) => r.realizedPnlUsd !== null)
    .sort(
      (a, b) =>
        a.lastActivityAtMs - b.lastActivityAtMs ||
        a.conditionId.localeCompare(b.conditionId),
    );
  let cumulative = 0;
  const points: TradingPerformanceChartPoint[] = [];
  for (const row of ordered) {
    const realizedPnlUsd = row.realizedPnlUsd ?? 0;
    cumulative += realizedPnlUsd;
    points.push({
      conditionId: row.conditionId,
      symbol: row.symbol,
      title: row.title,
      orderedAtMs: row.lastActivityAtMs,
      marketPnlUsd: realizedPnlUsd,
      cumulativePnlUsd: cumulative,
    });
  }
  return points;
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
