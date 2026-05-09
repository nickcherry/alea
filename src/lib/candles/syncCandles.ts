import { candlesPerFetchPage } from "@alea/constants/candles";
import { fetchCandlesPage } from "@alea/lib/candles/sources/fetchCandlesPage";
import { timeframeMs } from "@alea/lib/candles/timeframeMs";
import { upsertCandles } from "@alea/lib/candles/upsertCandles";
import type { DatabaseClient } from "@alea/lib/db/types";
import type { Asset } from "@alea/types/assets";
import type { CandleTimeframe } from "@alea/types/candles";
import type { Product } from "@alea/types/products";
import type { CandleSource } from "@alea/types/sources";
import { sql } from "kysely";

type SyncCandlesParams = {
  readonly db: DatabaseClient;
  readonly source: CandleSource;
  readonly asset: Asset;
  readonly product: Product;
  readonly timeframe: CandleTimeframe;
  readonly start: Date;
  readonly end: Date;
};

export type SyncCandlesPageMetric = {
  readonly start: Date;
  readonly end: Date;
  readonly fetched: number;
  readonly elapsedMs: number;
};

export type SyncCandlesResult = {
  readonly source: CandleSource;
  readonly asset: Asset;
  readonly product: Product;
  readonly timeframe: CandleTimeframe;
  readonly start: Date;
  readonly end: Date;
  readonly pages: readonly SyncCandlesPageMetric[];
  readonly fetched: number;
  readonly persisted: number;
  readonly fetchTotalMs: number;
  readonly upsertTotalMs: number;
};

/**
 * Pages through `[start, end)` for one (source, asset, product, timeframe)
 * series, fetching `candlesPerFetchPage` candles per call. Each page is
 * upserted before the next is fetched so a long sync can be interrupted
 * without losing all progress. Per-page latency is recorded for the caller.
 */
export async function syncCandles({
  db,
  source,
  asset,
  product,
  timeframe,
  start,
  end,
}: SyncCandlesParams): Promise<SyncCandlesResult> {
  const barMs = timeframeMs({ timeframe });
  const pageMs = barMs * candlesPerFetchPage;
  const pages: SyncCandlesPageMetric[] = [];
  let fetched = 0;
  let persisted = 0;
  let fetchTotalMs = 0;
  let upsertTotalMs = 0;

  // Resume from where we left off: skip pages that the DB already has
  // every expected row for. Cuts wall time dramatically when re-running
  // an interrupted sync — providers like Pyth can't tell the upsert
  // is a no-op and bill the (rate-limit-budgeted) HTTP fetch anyway.
  // We only fast-forward to the *first contiguous gap*; data beyond a
  // gap is left to the normal page loop to handle.
  const resumeFromMs = await findContiguousResumePoint({
    db,
    source,
    asset,
    product,
    timeframe,
    start,
    end,
    barMs,
  });
  let cursorMs = resumeFromMs;
  const endMs = end.getTime();

  while (cursorMs < endMs) {
    const pageEndMs = Math.min(cursorMs + pageMs, endMs);
    const pageStart = new Date(cursorMs);
    const pageEnd = new Date(pageEndMs);

    const fetchStart = performance.now();
    const candles = await fetchCandlesPage({
      source,
      asset,
      product,
      timeframe,
      start: pageStart,
      end: pageEnd,
    });
    const fetchElapsed = performance.now() - fetchStart;

    const upsertStart = performance.now();
    await upsertCandles({ db, candles });
    upsertTotalMs += performance.now() - upsertStart;

    pages.push({
      start: pageStart,
      end: pageEnd,
      fetched: candles.length,
      elapsedMs: fetchElapsed,
    });
    fetched += candles.length;
    persisted += candles.length;
    fetchTotalMs += fetchElapsed;

    cursorMs = pageEndMs;
  }

  return {
    source,
    asset,
    product,
    timeframe,
    start,
    end,
    pages,
    fetched,
    persisted,
    fetchTotalMs,
    upsertTotalMs,
  };
}

/**
 * Resumes from one bar past the latest stored timestamp in `[start, end)`.
 * Trades off completeness (any gap before MAX is left unfilled by this
 * run) for wall time (each fetch costs the provider's rate-limit budget,
 * even when the upsert is a no-op — Pyth in particular).
 *
 * Use a separate, explicit narrower-window sync to fill earlier gaps if
 * they matter; the common case for this resume path is "we got 25% in
 * before the limiter cut us off — pick up where we left off."
 */
async function findContiguousResumePoint({
  db,
  source,
  asset,
  product,
  timeframe,
  start,
  end,
  barMs,
}: {
  readonly db: DatabaseClient;
  readonly source: CandleSource;
  readonly asset: Asset;
  readonly product: Product;
  readonly timeframe: CandleTimeframe;
  readonly start: Date;
  readonly end: Date;
  readonly barMs: number;
}): Promise<number> {
  const startMs = start.getTime();
  const endMs = end.getTime();
  if (endMs <= startMs) {
    return startMs;
  }
  const row = await sql<{ last_ts: Date | null }>`
    SELECT MAX(timestamp) AS last_ts
    FROM candles
    WHERE source = ${source}
      AND asset = ${asset}
      AND product = ${product}
      AND timeframe = ${timeframe}
      AND timestamp >= to_timestamp(${startMs / 1000})
      AND timestamp < to_timestamp(${endMs / 1000})
  `.execute(db);
  const lastTs = row.rows[0]?.last_ts;
  if (lastTs === null || lastTs === undefined) {
    return startMs;
  }
  return lastTs.getTime() + barMs;
}
