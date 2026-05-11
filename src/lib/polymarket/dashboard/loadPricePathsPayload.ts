import { assetValues } from "@alea/constants/assets";
import type { DatabaseClient } from "@alea/lib/db/types";
import type {
  PricePathAggregateSlice,
  PricePathBandPoint,
  PricePathCrossingBucket,
  PricePathCrossings,
  PricePathHeatmapColumn,
  PricePathMarkerShare,
  PricePathsPayload,
  PricePathTimeframeBreakdown,
} from "@alea/lib/polymarket/dashboard/types";
import { resolutionTimeframeStepMs } from "@alea/lib/polymarket/enumerateWindowStarts";
import type { ResolutionTimeframe } from "@alea/types/resolutions";
import { resolutionTimeframeValues } from "@alea/types/resolutions";

const millisecondsPerSecond = 1000;
const millisecondsPerDay = 24 * 60 * 60 * millisecondsPerSecond;
const defaultLookbackDays = 30;
const priceBucketsCents = Array.from({ length: 101 }, (_, i) => i);

export type PricePathSampleRow = {
  readonly asset: string;
  readonly timeframe: ResolutionTimeframe;
  readonly window_start_ts_ms: string | number;
  readonly window_end_ts_ms: string | number;
  readonly samples: unknown;
};

type CompactPriceSample = {
  readonly offsetMs: number;
  readonly priceBps: number;
};

type PricePathWindow = {
  readonly asset: string;
  readonly timeframe: ResolutionTimeframe;
  readonly windowStartTsMs: number;
  readonly windowEndTsMs: number;
  readonly samples: readonly CompactPriceSample[];
};

type ColumnAccumulator = {
  sampleCount: number;
  withinOneCentCount: number;
  withinTwoCentCount: number;
  withinFiveCentCount: number;
  counts: number[];
  distancesCents: number[];
  /**
   * Distinct windows that contributed at least one sample to this
   * column. Used as the denominator for crossing share so a chart that
   * shows crossings-per-bucket aligns with the population of windows
   * that could have crossed there.
   */
  windowsObserved: Set<number>;
  crossingCount: number;
  windowsWithCrossing: Set<number>;
};

export async function loadPricePathsPayload({
  db,
  now = () => Date.now(),
  lookbackDays = defaultLookbackDays,
}: {
  readonly db: DatabaseClient;
  readonly now?: () => number;
  readonly lookbackDays?: number;
}): Promise<PricePathsPayload> {
  const generatedAtMs = now();
  const cutoffMs = generatedAtMs - lookbackDays * millisecondsPerDay;
  const rows = (await db
    .selectFrom("polymarket_price_samples")
    .select([
      "asset",
      "timeframe",
      "window_start_ts_ms",
      "window_end_ts_ms",
      "samples",
    ])
    .where("window_start_ts_ms", ">=", String(cutoffMs))
    .orderBy("timeframe", "asc")
    .orderBy("asset", "asc")
    .orderBy("window_start_ts_ms", "asc")
    .execute()) as readonly PricePathSampleRow[];

  return buildPricePathsPayloadFromRows({
    rows,
    generatedAtMs,
    lookbackDays,
    cutoffMs,
  });
}

export function buildPricePathsPayloadFromRows({
  rows,
  generatedAtMs,
  lookbackDays,
  cutoffMs,
}: {
  readonly rows: readonly PricePathSampleRow[];
  readonly generatedAtMs: number;
  readonly lookbackDays: number;
  readonly cutoffMs: number;
}): PricePathsPayload {
  const windows = rows
    .map(normalizeWindow)
    .filter((w): w is PricePathWindow => w !== null);

  let firstWindowMs: number | null = null;
  let lastWindowMs: number | null = null;
  for (const window of windows) {
    if (firstWindowMs === null || window.windowStartTsMs < firstWindowMs) {
      firstWindowMs = window.windowStartTsMs;
    }
    if (lastWindowMs === null || window.windowStartTsMs > lastWindowMs) {
      lastWindowMs = window.windowStartTsMs;
    }
  }

  const breakdowns: PricePathTimeframeBreakdown[] =
    resolutionTimeframeValues.map((timeframe) => {
      const durationMs = resolutionTimeframeStepMs({ timeframe });
      const timeBucketMs = timeBucketMsFor({ durationMs });
      const timeframeWindows = windows.filter((w) => w.timeframe === timeframe);
      const assets = sortedAssets({
        assets: new Set(timeframeWindows.map((w) => w.asset)),
      });
      const slices = [
        buildAggregateSlice({
          asset: null,
          label: "All assets",
          windows: timeframeWindows,
          durationMs,
          timeBucketMs,
        }),
        ...assets.map((asset) =>
          buildAggregateSlice({
            asset,
            label: asset.toUpperCase(),
            windows: timeframeWindows.filter((w) => w.asset === asset),
            durationMs,
            timeBucketMs,
          }),
        ),
      ];
      return {
        timeframe,
        durationMs,
        timeBucketMs,
        tableMarkersMs: tableMarkersMsFor({ durationMs, timeBucketMs }),
        slices,
      };
    });

  return {
    generatedAtMs,
    lookbackDays,
    cutoffMs,
    windowCount: windows.length,
    sampleCount: breakdowns.reduce(
      (sum, b) => sum + (b.slices[0]?.sampleCount ?? 0),
      0,
    ),
    firstWindowMs,
    lastWindowMs,
    breakdowns,
  };
}

function normalizeWindow(row: PricePathSampleRow): PricePathWindow | null {
  if (!isResolutionTimeframe(row.timeframe)) {
    return null;
  }
  const windowStartTsMs = Number(row.window_start_ts_ms);
  const windowEndTsMs = Number(row.window_end_ts_ms);
  if (!Number.isFinite(windowStartTsMs) || !Number.isFinite(windowEndTsMs)) {
    return null;
  }
  return {
    asset: row.asset,
    timeframe: row.timeframe,
    windowStartTsMs,
    windowEndTsMs,
    samples: parseSamples(row.samples),
  };
}

function parseSamples(raw: unknown): readonly CompactPriceSample[] {
  const value = typeof raw === "string" ? safeJsonParse(raw) : raw;
  if (!Array.isArray(value)) {
    return [];
  }
  const samples: CompactPriceSample[] = [];
  for (const item of value) {
    if (!Array.isArray(item) || item.length < 2) {
      continue;
    }
    const offsetMs = Number(item[0]);
    const priceBps = Number(item[1]);
    if (
      !Number.isFinite(offsetMs) ||
      !Number.isFinite(priceBps) ||
      offsetMs < 0
    ) {
      continue;
    }
    samples.push({
      offsetMs,
      priceBps: clamp({ value: Math.round(priceBps), min: 0, max: 10_000 }),
    });
  }
  return samples;
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function buildAggregateSlice({
  asset,
  label,
  windows,
  durationMs,
  timeBucketMs,
}: {
  readonly asset: string | null;
  readonly label: string;
  readonly windows: readonly PricePathWindow[];
  readonly durationMs: number;
  readonly timeBucketMs: number;
}): PricePathAggregateSlice {
  const columnCount = Math.ceil(durationMs / timeBucketMs);
  const columns = Array.from({ length: columnCount }, () =>
    createColumnAccumulator(),
  );
  const allDistancesCents: number[] = [];
  let sampleCount = 0;
  let withinOneCentCount = 0;
  let withinTwoCentCount = 0;
  let withinFiveCentCount = 0;
  let firstWindowMs: number | null = null;
  let lastWindowMs: number | null = null;

  let totalCrossings = 0;
  let windowsWithAnyCrossing = 0;

  for (let windowIndex = 0; windowIndex < windows.length; windowIndex += 1) {
    const window = windows[windowIndex]!;
    if (firstWindowMs === null || window.windowStartTsMs < firstWindowMs) {
      firstWindowMs = window.windowStartTsMs;
    }
    if (lastWindowMs === null || window.windowStartTsMs > lastWindowMs) {
      lastWindowMs = window.windowStartTsMs;
    }
    let crossingsInWindow = 0;
    let prevSide: "up" | "down" | null = null;
    for (let i = 0; i < window.samples.length; i += 1) {
      const sample = window.samples[i]!;
      const columnIndex = columnIndexForOffset({
        offsetMs: sample.offsetMs,
        durationMs,
        timeBucketMs,
        columnCount,
      });
      const column = columns[columnIndex];
      if (column === undefined) {
        prevSide = sideAt({ priceBps: sample.priceBps });
        continue;
      }
      const priceBucket = clamp({
        value: Math.round(sample.priceBps / 100),
        min: 0,
        max: 100,
      });
      const distanceCents = Math.abs(sample.priceBps - 5_000) / 100;
      const withinOne = inBand({ priceBps: sample.priceBps, cents: 1 });
      const withinTwo = inBand({ priceBps: sample.priceBps, cents: 2 });
      const withinFive = inBand({ priceBps: sample.priceBps, cents: 5 });

      column.counts[priceBucket] = (column.counts[priceBucket] ?? 0) + 1;
      column.sampleCount += 1;
      column.distancesCents.push(distanceCents);
      column.windowsObserved.add(windowIndex);
      if (withinOne) {
        column.withinOneCentCount += 1;
        withinOneCentCount += 1;
      }
      if (withinTwo) {
        column.withinTwoCentCount += 1;
        withinTwoCentCount += 1;
      }
      if (withinFive) {
        column.withinFiveCentCount += 1;
        withinFiveCentCount += 1;
      }
      allDistancesCents.push(distanceCents);
      sampleCount += 1;

      const currSide = sideAt({ priceBps: sample.priceBps });
      if (prevSide !== null && prevSide !== currSide) {
        column.crossingCount += 1;
        column.windowsWithCrossing.add(windowIndex);
        crossingsInWindow += 1;
      }
      prevSide = currSide;
    }
    if (crossingsInWindow > 0) {
      windowsWithAnyCrossing += 1;
    }
    totalCrossings += crossingsInWindow;
  }

  const bandSeries = columns.map((column, index) =>
    bandPointFromColumn({
      column,
      timeRemainingMs: columnTimeRemainingMs({
        index,
        durationMs,
        timeBucketMs,
      }),
    }),
  );
  const heatmapColumns = columns.map(
    (column, index): PricePathHeatmapColumn => {
      return {
        timeRemainingMs: columnTimeRemainingMs({
          index,
          durationMs,
          timeBucketMs,
        }),
        sampleCount: column.sampleCount,
        counts: column.counts,
      };
    },
  );

  const crossingBuckets = columns.map(
    (column, index): PricePathCrossingBucket => ({
      timeRemainingMs: columnTimeRemainingMs({
        index,
        durationMs,
        timeBucketMs,
      }),
      windowsObserved: column.windowsObserved.size,
      windowsWithCrossing: column.windowsWithCrossing.size,
      crossingCount: column.crossingCount,
    }),
  );
  const crossings: PricePathCrossings = {
    totalWindows: windows.length,
    windowsWithAnyCrossing,
    totalCrossings,
    meanCrossingsPerWindow:
      windows.length === 0 ? null : totalCrossings / windows.length,
    buckets: crossingBuckets,
  };

  return {
    asset,
    label,
    windowCount: windows.length,
    sampleCount,
    firstWindowMs,
    lastWindowMs,
    overallWithinOneCentShare: share({
      numerator: withinOneCentCount,
      denominator: sampleCount,
    }),
    overallWithinTwoCentShare: share({
      numerator: withinTwoCentCount,
      denominator: sampleCount,
    }),
    overallWithinFiveCentShare: share({
      numerator: withinFiveCentCount,
      denominator: sampleCount,
    }),
    medianDistanceCents: percentile({
      values: allDistancesCents,
      q: 0.5,
    }),
    p90DistanceCents: percentile({
      values: allDistancesCents,
      q: 0.9,
    }),
    heatmap: {
      priceBucketsCents,
      columns: heatmapColumns,
      maxColumnShare: maxColumnShare({ columns: heatmapColumns }),
    },
    bandSeries,
    markerShares: tableMarkersMsFor({ durationMs, timeBucketMs }).map(
      (timeRemainingMs): PricePathMarkerShare => {
        const point =
          bandSeries[
            columnIndexForTimeRemaining({
              timeRemainingMs,
              durationMs,
              timeBucketMs,
              columnCount,
            })
          ];
        return {
          timeRemainingMs,
          label: formatTimeRemaining({ ms: timeRemainingMs }),
          sampleCount: point?.sampleCount ?? 0,
          withinOneCentShare: point?.withinOneCentShare ?? null,
        };
      },
    ),
    crossings,
  };
}

/**
 * Side of the 50c line a sample falls on. `>= 50c` is "up" — Polymarket
 * settles a stationary close as the up side too, so the boundary
 * belongs to up.
 */
function sideAt({ priceBps }: { readonly priceBps: number }): "up" | "down" {
  return priceBps >= 5_000 ? "up" : "down";
}

function createColumnAccumulator(): ColumnAccumulator {
  return {
    sampleCount: 0,
    withinOneCentCount: 0,
    withinTwoCentCount: 0,
    withinFiveCentCount: 0,
    counts: Array.from({ length: 101 }, () => 0),
    distancesCents: [],
    windowsObserved: new Set<number>(),
    crossingCount: 0,
    windowsWithCrossing: new Set<number>(),
  };
}

function bandPointFromColumn({
  column,
  timeRemainingMs,
}: {
  readonly column: ColumnAccumulator;
  readonly timeRemainingMs: number;
}): PricePathBandPoint {
  return {
    timeRemainingMs,
    sampleCount: column.sampleCount,
    withinOneCentShare: share({
      numerator: column.withinOneCentCount,
      denominator: column.sampleCount,
    }),
    withinTwoCentShare: share({
      numerator: column.withinTwoCentCount,
      denominator: column.sampleCount,
    }),
    withinFiveCentShare: share({
      numerator: column.withinFiveCentCount,
      denominator: column.sampleCount,
    }),
    p50DistanceCents: percentile({ values: column.distancesCents, q: 0.5 }),
    p75DistanceCents: percentile({ values: column.distancesCents, q: 0.75 }),
    p90DistanceCents: percentile({ values: column.distancesCents, q: 0.9 }),
  };
}

function maxColumnShare({
  columns,
}: {
  readonly columns: readonly PricePathHeatmapColumn[];
}): number {
  let max = 0;
  for (const column of columns) {
    if (column.sampleCount === 0) {
      continue;
    }
    for (const count of column.counts) {
      max = Math.max(max, count / column.sampleCount);
    }
  }
  return max;
}

/**
 * Time-bucket width used by the heatmap, band-decay chart, and 50c
 * crossings chart/table. 10 seconds across every timeframe so the per-
 * bucket numbers stay comparable between 5m and 15m and the crossings
 * table reads at the same resolution the operator asked for.
 */
function timeBucketMsFor({
  durationMs: _durationMs,
}: {
  readonly durationMs: number;
}): number {
  return 10 * millisecondsPerSecond;
}

function tableMarkersMsFor({
  durationMs,
  timeBucketMs,
}: {
  readonly durationMs: number;
  readonly timeBucketMs: number;
}): readonly number[] {
  const markers =
    durationMs <= 5 * 60 * millisecondsPerSecond
      ? [
          4 * 60 * millisecondsPerSecond,
          3 * 60 * millisecondsPerSecond,
          2 * 60 * millisecondsPerSecond,
          60 * millisecondsPerSecond,
          30 * millisecondsPerSecond,
          10 * millisecondsPerSecond,
        ]
      : [
          10 * 60 * millisecondsPerSecond,
          5 * 60 * millisecondsPerSecond,
          3 * 60 * millisecondsPerSecond,
          60 * millisecondsPerSecond,
          30 * millisecondsPerSecond,
        ];
  return markers.filter((ms) => ms <= durationMs && ms >= timeBucketMs);
}

function columnIndexForOffset({
  offsetMs,
  durationMs,
  timeBucketMs,
  columnCount,
}: {
  readonly offsetMs: number;
  readonly durationMs: number;
  readonly timeBucketMs: number;
  readonly columnCount: number;
}): number {
  const boundedOffset = clamp({ value: offsetMs, min: 0, max: durationMs - 1 });
  return clamp({
    value: Math.floor(boundedOffset / timeBucketMs),
    min: 0,
    max: columnCount - 1,
  });
}

function columnIndexForTimeRemaining({
  timeRemainingMs,
  durationMs,
  timeBucketMs,
  columnCount,
}: {
  readonly timeRemainingMs: number;
  readonly durationMs: number;
  readonly timeBucketMs: number;
  readonly columnCount: number;
}): number {
  const offsetMs = durationMs - timeRemainingMs;
  return columnIndexForOffset({
    offsetMs,
    durationMs,
    timeBucketMs,
    columnCount,
  });
}

function columnTimeRemainingMs({
  index,
  durationMs,
  timeBucketMs,
}: {
  readonly index: number;
  readonly durationMs: number;
  readonly timeBucketMs: number;
}): number {
  return Math.max(0, Math.round(durationMs - (index + 0.5) * timeBucketMs));
}

function formatTimeRemaining({ ms }: { readonly ms: number }): string {
  const totalSeconds = Math.max(0, Math.round(ms / millisecondsPerSecond));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `T-${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function inBand({
  priceBps,
  cents,
}: {
  readonly priceBps: number;
  readonly cents: number;
}): boolean {
  const widthBps = cents * 100;
  return priceBps >= 5_000 - widthBps && priceBps <= 5_000 + widthBps;
}

function share({
  numerator,
  denominator,
}: {
  readonly numerator: number;
  readonly denominator: number;
}): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function percentile({
  values,
  q,
}: {
  readonly values: readonly number[];
  readonly q: number;
}): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * q;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const lowerValue = sorted[lower];
  const upperValue = sorted[upper];
  if (lowerValue === undefined || upperValue === undefined) {
    return null;
  }
  if (lower === upper) {
    return lowerValue;
  }
  return lowerValue + (upperValue - lowerValue) * (index - lower);
}

function sortedAssets({
  assets,
}: {
  readonly assets: ReadonlySet<string>;
}): string[] {
  const known = assetValues.filter((asset) => assets.has(asset));
  const unknown = Array.from(assets)
    .filter(
      (asset) => !assetValues.includes(asset as (typeof assetValues)[number]),
    )
    .sort((a, b) => a.localeCompare(b));
  return [...known, ...unknown];
}

function isResolutionTimeframe(value: string): value is ResolutionTimeframe {
  return resolutionTimeframeValues.includes(value as ResolutionTimeframe);
}

function clamp({
  value,
  min,
  max,
}: {
  readonly value: number;
  readonly min: number;
  readonly max: number;
}): number {
  return Math.min(max, Math.max(min, value));
}
