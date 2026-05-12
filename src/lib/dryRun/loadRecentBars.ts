import type { TradeDecisionPeriod } from "@alea/constants/tradeDecision";
import type { DatabaseClient } from "@alea/lib/db/types";
import type { FilterBar } from "@alea/lib/filters/types";
import type { Asset } from "@alea/types/assets";

/**
 * Hydrates a rolling bar buffer from the canonical `candles`
 * table. The dry-run runner needs this on startup so the first
 * committee decision has enough history to run every filter.
 * The configured limit is comfortably above the longest filter's
 * requiredBars at the supported trade-decision periods.
 *
 * Returns bars in chronological order (oldest first), matching the
 * order the committee expects.
 */
export async function loadRecentBars({
  db,
  asset,
  period,
  limit,
}: {
  readonly db: DatabaseClient;
  readonly asset: Asset;
  readonly period: TradeDecisionPeriod;
  readonly limit: number;
}): Promise<FilterBar[]> {
  const rows = await db
    .selectFrom("candles")
    .select(["timestamp", "open", "high", "low", "close", "volume"])
    .where("source", "=", "pyth")
    .where("product", "=", "spot")
    .where("asset", "=", asset)
    .where("timeframe", "=", period)
    .orderBy("timestamp", "desc")
    .limit(limit)
    .execute();
  return rows
    .map((r) => ({
      openTimeMs:
        r.timestamp instanceof Date
          ? r.timestamp.getTime()
          : new Date(r.timestamp).getTime(),
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: r.volume,
    }))
    .reverse();
}
