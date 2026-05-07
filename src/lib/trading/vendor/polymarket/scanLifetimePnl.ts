import {
  type DataApiFetch,
  scanPolymarketTradingPerformance,
} from "@alea/lib/trading/vendor/polymarket/scanTradingPerformance";
import type {
  LifetimePnlScanProgress,
  LifetimePnlScanResult,
} from "@alea/lib/trading/vendor/types";

/**
 * Polymarket implementation of `Vendor.scanLifetimePnl`. Delegates to
 * `scanPolymarketTradingPerformance`, the same data-api scan that
 * powers the live trading dashboard, and projects its summary to the
 * minimal shape the runner needs.
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
    onProgress,
    dataApiFetch,
  });
  return {
    lifetimePnlUsd: payload.summary.lifetimePnlUsd,
    marketCount: payload.summary.marketCount,
    openPositionCount: payload.summary.openPositionCount,
  };
}
