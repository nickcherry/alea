import { TRAINING_OUTCOME_MIN_ABS_MOVE_PCT } from "@alea/constants/training";
import type { DatabaseClient } from "@alea/lib/db/types";
import {
  aggregateProxyAccuracy,
  histogramByMovePct,
} from "@alea/lib/polymarket/dashboard/aggregateProxyAccuracy";
import type {
  ProxyAccuracyAssetRow,
  ProxyAccuracyCoverage,
  ProxyAccuracyDisagreement,
  ProxyAccuracyPayload,
  ProxyAccuracyTimeframeBreakdown,
} from "@alea/lib/polymarket/dashboard/types";
import type { ResolutionTimeframe } from "@alea/types/resolutions";
import { resolutionTimeframeValues } from "@alea/types/resolutions";
import { sql } from "kysely";

const EXTREME_DISAGREEMENT_LIMIT = 50;

type JoinedRow = {
  readonly asset: string;
  readonly timeframe: ResolutionTimeframe;
  readonly window_start_ts_ms: string;
  readonly poly_outcome: "up" | "down" | "void";
  readonly pyth_open: number | null;
  readonly pyth_close: number | null;
};

export async function loadProxyAccuracyPayload({
  db,
  now = () => Date.now(),
}: {
  readonly db: DatabaseClient;
  readonly now?: () => number;
}): Promise<ProxyAccuracyPayload> {
  // Use a single window-aligned join so the entire dashboard derives
  // from one consistent snapshot. The volume is bounded (~200k rows over
  // 200 days × 5 assets × 2 timeframes); pulling them all into memory
  // keeps the aggregation code straightforward and lets us compute
  // medians / p90s without a SQL dance.
  const rowsResult = await sql<JoinedRow>`
    select
      poly.asset as asset,
      poly.timeframe as timeframe,
      poly.window_start_ts_ms as window_start_ts_ms,
      poly.outcome as poly_outcome,
      pyth.open as pyth_open,
      pyth.close as pyth_close
    from polymarket_resolutions poly
    left join candles pyth
      on pyth.source = 'pyth'
      and pyth.product = 'spot'
      and pyth.asset = poly.asset
      and pyth.timeframe = poly.timeframe
      and pyth.timestamp = to_timestamp(poly.window_start_ts_ms / 1000.0)
  `.execute(db);

  const rows = rowsResult.rows;
  let polymarketRows = 0;
  let joinedRows = 0;
  let voidRows = 0;
  let missingPythRows = 0;
  let firstWindowMs: number | null = null;
  let lastWindowMs: number | null = null;

  // Bucket joined rows by timeframe → asset for later aggregation.
  const byTimeframe = new Map<
    ResolutionTimeframe,
    Map<
      string,
      Array<{
        readonly windowStartTsMs: number;
        readonly polyOutcome: "up" | "down";
        readonly pythOutcome: "up" | "down";
        readonly pythOpen: number;
        readonly pythClose: number;
        readonly absMovePct: number;
      }>
    >
  >();
  for (const tf of resolutionTimeframeValues) {
    byTimeframe.set(tf, new Map());
  }

  for (const row of rows) {
    polymarketRows += 1;
    const ts = Number(row.window_start_ts_ms);
    if (firstWindowMs === null || ts < firstWindowMs) {
      firstWindowMs = ts;
    }
    if (lastWindowMs === null || ts > lastWindowMs) {
      lastWindowMs = ts;
    }
    if (row.poly_outcome === "void") {
      voidRows += 1;
      continue;
    }
    if (row.pyth_open === null || row.pyth_close === null) {
      missingPythRows += 1;
      continue;
    }
    if (row.pyth_open === 0) {
      // Defensive — wouldn't expect open=0 for a live crypto candle,
      // but the move-percent math divides by it.
      missingPythRows += 1;
      continue;
    }
    joinedRows += 1;

    const pythOutcome: "up" | "down" =
      row.pyth_close >= row.pyth_open ? "up" : "down";
    const absMovePct =
      (Math.abs(row.pyth_close - row.pyth_open) / row.pyth_open) * 100;
    const bucket = byTimeframe.get(row.timeframe);
    if (bucket === undefined) {
      continue;
    }
    let list = bucket.get(row.asset);
    if (list === undefined) {
      list = [];
      bucket.set(row.asset, list);
    }
    list.push({
      windowStartTsMs: ts,
      polyOutcome: row.poly_outcome,
      pythOutcome,
      pythOpen: row.pyth_open,
      pythClose: row.pyth_close,
      absMovePct,
    });
  }

  const coverage: ProxyAccuracyCoverage = {
    polymarketRows,
    joinedRows,
    voidRows,
    missingPythRows,
    firstWindowMs,
    lastWindowMs,
  };

  const breakdowns: ProxyAccuracyTimeframeBreakdown[] = [];
  for (const timeframe of resolutionTimeframeValues) {
    const assetMap = byTimeframe.get(timeframe);
    if (assetMap === undefined) {
      continue;
    }
    const allEntries = Array.from(assetMap.values()).flat();

    const perAsset: ProxyAccuracyAssetRow[] = Array.from(assetMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([asset, entries]) => ({
        asset,
        aggregate: aggregateProxyAccuracy({
          entries,
          clearMovePct: TRAINING_OUTCOME_MIN_ABS_MOVE_PCT,
        }),
      }));

    breakdowns.push({
      timeframe,
      aggregate: aggregateProxyAccuracy({
        entries: allEntries,
        clearMovePct: TRAINING_OUTCOME_MIN_ABS_MOVE_PCT,
      }),
      perAsset,
      moveBucketsAll: histogramByMovePct({
        moves: allEntries.map((e) => e.absMovePct),
      }),
    });
  }

  const extremeDisagreements = collectExtremeDisagreements({
    byTimeframe,
    limit: EXTREME_DISAGREEMENT_LIMIT,
  });

  return {
    generatedAtMs: now(),
    coverage,
    trainingThresholdPct: TRAINING_OUTCOME_MIN_ABS_MOVE_PCT,
    breakdowns,
    extremeDisagreements,
  };
}

function collectExtremeDisagreements({
  byTimeframe,
  limit,
}: {
  readonly byTimeframe: ReadonlyMap<
    ResolutionTimeframe,
    ReadonlyMap<
      string,
      ReadonlyArray<{
        readonly windowStartTsMs: number;
        readonly polyOutcome: "up" | "down";
        readonly pythOutcome: "up" | "down";
        readonly pythOpen: number;
        readonly pythClose: number;
        readonly absMovePct: number;
      }>
    >
  >;
  readonly limit: number;
}): readonly ProxyAccuracyDisagreement[] {
  const disagreements: ProxyAccuracyDisagreement[] = [];
  for (const [timeframe, assetMap] of byTimeframe) {
    for (const [asset, entries] of assetMap) {
      for (const entry of entries) {
        if (entry.polyOutcome !== entry.pythOutcome) {
          disagreements.push({
            asset,
            timeframe,
            windowStartTsMs: entry.windowStartTsMs,
            polyOutcome: entry.polyOutcome,
            pythOutcome: entry.pythOutcome,
            pythOpen: entry.pythOpen,
            pythClose: entry.pythClose,
            absMovePct: entry.absMovePct,
          });
        }
      }
    }
  }
  disagreements.sort((a, b) => b.absMovePct - a.absMovePct);
  return disagreements.slice(0, limit);
}
