import type { DatabaseClient } from "@alea/lib/db/types";
import {
  alignBarSeries,
  type AlignedBarSeries,
} from "@alea/lib/filters/barSeries";
import type { FilterBar } from "@alea/lib/filters/types";
import type { Asset } from "@alea/types/assets";
import type { CandleTimeframe } from "@alea/types/candles";

/**
 * The single sanctioned way to load bars for filter input. Reads
 * Pyth/spot AND Coinbase/spot bars for `(asset, timeframe)`,
 * aligns them by `openTimeMs`, and returns an `AlignedBarSeries`.
 *
 * Pyth is the canonical timeline because it's the Polymarket
 * settlement proxy used for outcome labeling. Coinbase bars are
 * looked up by Pyth's timestamps; any missing Coinbase bar becomes
 * a `null` slot in the bundle so volume filters cleanly abstain
 * for that decision moment.
 *
 * Optional window bounds slice the canonical Pyth series; the
 * Coinbase fetch fetches the same window so the aligner has a
 * sensible lookup set.
 *
 * No fallbacks. If callers want a single-source view (e.g. for a
 * proxy-accuracy report on raw Pyth bars), they should read
 * `candles` directly — this helper is exclusively for filter
 * pipelines.
 */
export async function loadAlignedBarSeries({
  db,
  asset,
  timeframe,
  windowStartMs,
  windowEndExclusiveMs,
}: {
  readonly db: DatabaseClient;
  readonly asset: Asset;
  readonly timeframe: CandleTimeframe;
  readonly windowStartMs?: number;
  readonly windowEndExclusiveMs?: number;
}): Promise<AlignedBarSeries> {
  const [pythRows, coinbaseRows] = await Promise.all([
    loadSourceBars({
      db,
      source: "pyth",
      asset,
      timeframe,
      windowStartMs,
      windowEndExclusiveMs,
    }),
    loadSourceBars({
      db,
      source: "coinbase",
      asset,
      timeframe,
      windowStartMs,
      windowEndExclusiveMs,
    }),
  ]);
  return alignBarSeries({ pyth: pythRows, coinbase: coinbaseRows });
}

async function loadSourceBars({
  db,
  source,
  asset,
  timeframe,
  windowStartMs,
  windowEndExclusiveMs,
}: {
  readonly db: DatabaseClient;
  readonly source: "pyth" | "coinbase";
  readonly asset: Asset;
  readonly timeframe: CandleTimeframe;
  readonly windowStartMs?: number;
  readonly windowEndExclusiveMs?: number;
}): Promise<readonly FilterBar[]> {
  let query = db
    .selectFrom("candles")
    .select(["timestamp", "open", "high", "low", "close", "volume"])
    .where("source", "=", source)
    .where("product", "=", "spot")
    .where("asset", "=", asset)
    .where("timeframe", "=", timeframe);
  if (windowStartMs !== undefined) {
    query = query.where("timestamp", ">=", new Date(windowStartMs));
  }
  if (windowEndExclusiveMs !== undefined) {
    query = query.where("timestamp", "<", new Date(windowEndExclusiveMs));
  }
  const rows = await query.orderBy("timestamp", "asc").execute();
  return rows.map((r) => ({
    openTimeMs:
      r.timestamp instanceof Date
        ? r.timestamp.getTime()
        : new Date(r.timestamp).getTime(),
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    volume: r.volume,
  }));
}
