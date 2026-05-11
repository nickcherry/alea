import type { DatabaseClient } from "@alea/lib/db/types";
import type { FilterBar } from "@alea/lib/filters/types";
import type { Asset } from "@alea/types/assets";

/**
 * Hydrates a rolling bar buffer from the canonical `candles`
 * table. The dry-run runner needs this on startup so the first
 * committee decision has enough history to run every filter.
 * 120 bars is comfortably above the longest filter's requiredBars
 * at 5m.
 *
 * Returns bars in chronological order (oldest first), matching the
 * order the committee expects.
 */
export async function loadRecentBars({
  db,
  asset,
  limit,
}: {
  readonly db: DatabaseClient;
  readonly asset: Asset;
  readonly limit: number;
}): Promise<FilterBar[]> {
  const rows = await db
    .selectFrom("candles")
    .select(["timestamp", "open", "high", "low", "close", "volume"])
    .where("source", "=", "pyth")
    .where("product", "=", "spot")
    .where("asset", "=", asset)
    .where("timeframe", "=", "5m")
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
