import {
  type DataApiFetch,
  scanPolymarketTradingPerformance,
} from "@alea/lib/trading/vendor/polymarket/scanTradingPerformance";

/**
 * One progress callback emission. The two `kind`s correspond to the
 * two pagination cursors the data-api scan walks — `/activity` and
 * `/positions`. The dashboard scan also emits `trades-page` events
 * (CLOB-side), but they're filtered out here because the lifetime
 * scan never touches CLOB.
 */
export type LifetimePnlScanProgress =
  | { readonly kind: "activity-page"; readonly activitiesSoFar: number }
  | { readonly kind: "positions-page"; readonly positionsSoFar: number };

export type LifetimePnlScanResult = {
  readonly lifetimePnlUsd: number;
  readonly marketCount: number;
  readonly openPositionCount: number;
};

/**
 * Lifetime-PnL scan for a single Polymarket funder address. Delegates
 * to `scanPolymarketTradingPerformance`, the same data-api scan that
 * powers the live trading dashboard, and projects its summary to the
 * minimal shape `trading:hydrate-lifetime-pnl` needs.
 *
 * Source of truth: data-api `/activity` (cashflow ground truth: BUY /
 * REDEEM / SELL / MAKER_REBATE / SPLIT / MERGE) plus `/positions`
 * (mark-to-market for currently-held markets). Lifetime PnL =
 * returned + currentValue − invested + makerRebates, which is what
 * the dashboard displays.
 *
 * Why not /trades or CLOB getTradesPaginated:
 * - /trades silently truncates older fills.
 * - CLOB-side resolved-market PnL ignores still-open positions, which
 *   meaningfully understates lifetime PnL while a window is settling
 *   between fill and on-chain redemption.
 */
export async function scanPolymarketLifetimePnl({
  funderAddress,
  onProgress,
  dataApiFetch,
}: {
  readonly funderAddress: string;
  readonly onProgress?: (event: LifetimePnlScanProgress) => void;
  readonly dataApiFetch?: DataApiFetch;
}): Promise<LifetimePnlScanResult> {
  const payload = await scanPolymarketTradingPerformance({
    funderAddress,
    dataApiFetch,
    // We don't pass clobClient, so `scanPolymarketTradingPerformance`
    // won't emit trades-page events — but its union type still
    // includes them, so we filter at the boundary.
    onProgress: onProgress
      ? (event) => {
          if (
            event.kind === "activity-page" ||
            event.kind === "positions-page"
          ) {
            onProgress(event);
          }
        }
      : undefined,
  });
  return {
    lifetimePnlUsd: payload.summary.lifetimePnlUsd,
    marketCount: payload.summary.marketCount,
    openPositionCount: payload.summary.openPositionCount,
  };
}
