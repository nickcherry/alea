import { assetValues } from "@alea/constants/assets";
import {
  LEAD_MINUTES_BY_PERIOD,
  LEAD_TIME_DRIFT_THRESHOLD_BPS,
} from "@alea/constants/leadTimeDrift";
import { TRAINING_WINDOW_END_EXCLUSIVE_MS } from "@alea/constants/researchWindows";
import type { DatabaseClient } from "@alea/lib/db/types";
import { resolutionTimeframeStepMs } from "@alea/lib/polymarket/enumerateWindowStarts";
import type { Asset } from "@alea/types/assets";
import type { ResolutionTimeframe } from "@alea/types/resolutions";
import { resolutionTimeframeValues } from "@alea/types/resolutions";
import { sql } from "kysely";

const millisecondsPerMinute = 60_000;

export type LeadTimeDriftLeadPoint = {
  readonly leadMinutes: number;
  readonly sampleCount: number;
  readonly missingSampleCount: number;
  readonly signedMeanBps: number | null;
  readonly absMedianBps: number | null;
  readonly absP75Bps: number | null;
  readonly absP90Bps: number | null;
  readonly absP99Bps: number | null;
  /**
   * Per-threshold share of candles whose `|drift_bps|` is ≤ the
   * threshold value. Order matches `LEAD_TIME_DRIFT_THRESHOLD_BPS`.
   */
  readonly thresholdShares: readonly (number | null)[];
};

export type LeadTimeDriftSlice = {
  readonly asset: string | null;
  readonly label: string;
  readonly candleCount: number;
  readonly leads: readonly LeadTimeDriftLeadPoint[];
};

export type LeadTimeDriftTimeframeBreakdown = {
  readonly timeframe: ResolutionTimeframe;
  readonly leadMinutes: readonly number[];
  readonly slices: readonly LeadTimeDriftSlice[];
};

export type LeadTimeDriftPayload = {
  readonly generatedAtMs: number;
  readonly trainingWindowEndExclusiveMs: number;
  readonly thresholdsBps: readonly number[];
  readonly hasOneMinuteCandles: boolean;
  readonly firstCandleMs: number | null;
  readonly lastCandleMs: number | null;
  readonly breakdowns: readonly LeadTimeDriftTimeframeBreakdown[];
};

/**
 * One row per `(asset, timeframe, leadMinutes)` already aggregated by
 * Postgres. `withinBpsCounts` is parallel to
 * `LEAD_TIME_DRIFT_THRESHOLD_BPS`. The payload builder turns these into
 * the dashboard-ready slice structure.
 */
export type LeadTimeDriftAggregateRow = {
  readonly asset: Asset;
  readonly timeframe: ResolutionTimeframe;
  readonly leadMinutes: number;
  readonly sampleCount: number;
  readonly missingCount: number;
  readonly signedMeanBps: number | null;
  readonly absP50Bps: number | null;
  readonly absP75Bps: number | null;
  readonly absP90Bps: number | null;
  readonly absP99Bps: number | null;
  readonly withinBpsCounts: readonly number[];
  readonly firstCandleMs: number | null;
  readonly lastCandleMs: number | null;
};

export async function loadLeadTimeDriftPayload({
  db,
  now = () => Date.now(),
}: {
  readonly db: DatabaseClient;
  readonly now?: () => number;
}): Promise<LeadTimeDriftPayload> {
  const generatedAtMs = now();
  const trainingWindowEndExclusiveMs = TRAINING_WINDOW_END_EXCLUSIVE_MS;

  const hasOneMinuteCandles = await checkOneMinuteCandlesExist({
    db,
    endExclusiveMs: trainingWindowEndExclusiveMs,
  });
  if (!hasOneMinuteCandles) {
    return emptyPayload({ generatedAtMs, trainingWindowEndExclusiveMs });
  }

  const rows = await fetchAggregateRows({
    db,
    endExclusiveMs: trainingWindowEndExclusiveMs,
  });

  return buildLeadTimeDriftPayloadFromAggregateRows({
    rows,
    generatedAtMs,
    trainingWindowEndExclusiveMs,
    hasOneMinuteCandles: true,
  });
}

export function buildLeadTimeDriftPayloadFromAggregateRows({
  rows,
  generatedAtMs,
  trainingWindowEndExclusiveMs,
  hasOneMinuteCandles,
}: {
  readonly rows: readonly LeadTimeDriftAggregateRow[];
  readonly generatedAtMs: number;
  readonly trainingWindowEndExclusiveMs: number;
  readonly hasOneMinuteCandles: boolean;
}): LeadTimeDriftPayload {
  if (!hasOneMinuteCandles) {
    return emptyPayload({ generatedAtMs, trainingWindowEndExclusiveMs });
  }

  let firstCandleMs: number | null = null;
  let lastCandleMs: number | null = null;
  for (const row of rows) {
    if (
      row.firstCandleMs !== null &&
      (firstCandleMs === null || row.firstCandleMs < firstCandleMs)
    ) {
      firstCandleMs = row.firstCandleMs;
    }
    if (
      row.lastCandleMs !== null &&
      (lastCandleMs === null || row.lastCandleMs > lastCandleMs)
    ) {
      lastCandleMs = row.lastCandleMs;
    }
  }

  // Group rows by (timeframe, asset). The aggregate rows are
  // (asset, timeframe, lead) → stats, so each (timeframe, asset) sees
  // one row per lead in its set.
  const rowsByAssetTimeframe = new Map<string, LeadTimeDriftAggregateRow[]>();
  for (const row of rows) {
    const key = `${row.timeframe}::${row.asset}`;
    const existing = rowsByAssetTimeframe.get(key);
    if (existing === undefined) {
      rowsByAssetTimeframe.set(key, [row]);
    } else {
      existing.push(row);
    }
  }

  const breakdowns: LeadTimeDriftTimeframeBreakdown[] = [];
  for (const timeframe of resolutionTimeframeValues) {
    const slices: LeadTimeDriftSlice[] = [];
    // Per-asset slices.
    for (const asset of assetValues) {
      const sliceRows =
        rowsByAssetTimeframe.get(`${timeframe}::${asset}`) ?? [];
      slices.push(
        materializeSlice({
          asset,
          label: asset.toUpperCase(),
          rows: sliceRows,
          timeframe,
        }),
      );
    }
    // All-assets rollup — collapse per-asset rows by summing counts and
    // re-deriving the absolute-percentile by weighted averaging the
    // per-asset values. Postgres provides per-asset percentiles, so the
    // rollup is approximate. Good enough for the at-a-glance view; the
    // operator can drill into a single asset for an exact number.
    const allAssetRows = aggregateAcrossAssets({
      rowsByAssetTimeframe,
      timeframe,
    });
    slices.unshift(
      materializeSlice({
        asset: null,
        label: "All assets",
        rows: allAssetRows,
        timeframe,
      }),
    );
    breakdowns.push({
      timeframe,
      leadMinutes: LEAD_MINUTES_BY_PERIOD[timeframe],
      slices,
    });
  }

  return {
    generatedAtMs,
    trainingWindowEndExclusiveMs,
    thresholdsBps: LEAD_TIME_DRIFT_THRESHOLD_BPS,
    hasOneMinuteCandles: true,
    firstCandleMs,
    lastCandleMs,
    breakdowns,
  };
}

function materializeSlice({
  asset,
  label,
  rows,
  timeframe,
}: {
  readonly asset: string | null;
  readonly label: string;
  readonly rows: readonly LeadTimeDriftAggregateRow[];
  readonly timeframe: ResolutionTimeframe;
}): LeadTimeDriftSlice {
  const byLead = new Map<number, LeadTimeDriftAggregateRow>();
  let candleCount = 0;
  for (const row of rows) {
    byLead.set(row.leadMinutes, row);
    if (row.sampleCount > candleCount) {
      candleCount = row.sampleCount + row.missingCount;
    }
  }
  const leads: LeadTimeDriftLeadPoint[] = [];
  for (const leadMinutes of LEAD_MINUTES_BY_PERIOD[timeframe]) {
    const row = byLead.get(leadMinutes);
    if (row === undefined) {
      leads.push({
        leadMinutes,
        sampleCount: 0,
        missingSampleCount: 0,
        signedMeanBps: null,
        absMedianBps: null,
        absP75Bps: null,
        absP90Bps: null,
        absP99Bps: null,
        thresholdShares: LEAD_TIME_DRIFT_THRESHOLD_BPS.map(() => null),
      });
      continue;
    }
    leads.push({
      leadMinutes: row.leadMinutes,
      sampleCount: row.sampleCount,
      missingSampleCount: row.missingCount,
      signedMeanBps: row.signedMeanBps,
      absMedianBps: row.absP50Bps,
      absP75Bps: row.absP75Bps,
      absP90Bps: row.absP90Bps,
      absP99Bps: row.absP99Bps,
      thresholdShares: row.withinBpsCounts.map((withinCount) =>
        row.sampleCount === 0 ? null : withinCount / row.sampleCount,
      ),
    });
  }
  return { asset, label, candleCount, leads };
}

function aggregateAcrossAssets({
  rowsByAssetTimeframe,
  timeframe,
}: {
  readonly rowsByAssetTimeframe: ReadonlyMap<
    string,
    readonly LeadTimeDriftAggregateRow[]
  >;
  readonly timeframe: ResolutionTimeframe;
}): readonly LeadTimeDriftAggregateRow[] {
  const byLead = new Map<
    number,
    {
      sample: number;
      missing: number;
      signedWeighted: number;
      p50Weighted: number;
      p75Weighted: number;
      p90Weighted: number;
      p99Weighted: number;
      withinCounts: number[];
      firstCandleMs: number | null;
      lastCandleMs: number | null;
    }
  >();
  for (const asset of assetValues) {
    const assetRows = rowsByAssetTimeframe.get(`${timeframe}::${asset}`) ?? [];
    for (const row of assetRows) {
      const existing = byLead.get(row.leadMinutes);
      if (existing === undefined) {
        byLead.set(row.leadMinutes, {
          sample: row.sampleCount,
          missing: row.missingCount,
          signedWeighted: (row.signedMeanBps ?? 0) * row.sampleCount,
          p50Weighted: (row.absP50Bps ?? 0) * row.sampleCount,
          p75Weighted: (row.absP75Bps ?? 0) * row.sampleCount,
          p90Weighted: (row.absP90Bps ?? 0) * row.sampleCount,
          p99Weighted: (row.absP99Bps ?? 0) * row.sampleCount,
          withinCounts: [...row.withinBpsCounts],
          firstCandleMs: row.firstCandleMs,
          lastCandleMs: row.lastCandleMs,
        });
        continue;
      }
      existing.sample += row.sampleCount;
      existing.missing += row.missingCount;
      existing.signedWeighted += (row.signedMeanBps ?? 0) * row.sampleCount;
      existing.p50Weighted += (row.absP50Bps ?? 0) * row.sampleCount;
      existing.p75Weighted += (row.absP75Bps ?? 0) * row.sampleCount;
      existing.p90Weighted += (row.absP90Bps ?? 0) * row.sampleCount;
      existing.p99Weighted += (row.absP99Bps ?? 0) * row.sampleCount;
      for (let i = 0; i < existing.withinCounts.length; i += 1) {
        existing.withinCounts[i]! += row.withinBpsCounts[i] ?? 0;
      }
      if (
        row.firstCandleMs !== null &&
        (existing.firstCandleMs === null ||
          row.firstCandleMs < existing.firstCandleMs)
      ) {
        existing.firstCandleMs = row.firstCandleMs;
      }
      if (
        row.lastCandleMs !== null &&
        (existing.lastCandleMs === null ||
          row.lastCandleMs > existing.lastCandleMs)
      ) {
        existing.lastCandleMs = row.lastCandleMs;
      }
    }
  }
  const rows: LeadTimeDriftAggregateRow[] = [];
  for (const [leadMinutes, acc] of byLead.entries()) {
    rows.push({
      asset: "btc" as Asset,
      timeframe,
      leadMinutes,
      sampleCount: acc.sample,
      missingCount: acc.missing,
      signedMeanBps: acc.sample === 0 ? null : acc.signedWeighted / acc.sample,
      absP50Bps: acc.sample === 0 ? null : acc.p50Weighted / acc.sample,
      absP75Bps: acc.sample === 0 ? null : acc.p75Weighted / acc.sample,
      absP90Bps: acc.sample === 0 ? null : acc.p90Weighted / acc.sample,
      absP99Bps: acc.sample === 0 ? null : acc.p99Weighted / acc.sample,
      withinBpsCounts: acc.withinCounts,
      firstCandleMs: acc.firstCandleMs,
      lastCandleMs: acc.lastCandleMs,
    });
  }
  return rows;
}

function emptyPayload({
  generatedAtMs,
  trainingWindowEndExclusiveMs,
}: {
  readonly generatedAtMs: number;
  readonly trainingWindowEndExclusiveMs: number;
}): LeadTimeDriftPayload {
  return {
    generatedAtMs,
    trainingWindowEndExclusiveMs,
    thresholdsBps: LEAD_TIME_DRIFT_THRESHOLD_BPS,
    hasOneMinuteCandles: false,
    firstCandleMs: null,
    lastCandleMs: null,
    breakdowns: resolutionTimeframeValues.map((timeframe) => ({
      timeframe,
      leadMinutes: LEAD_MINUTES_BY_PERIOD[timeframe],
      slices: [],
    })),
  };
}

async function checkOneMinuteCandlesExist({
  db,
  endExclusiveMs,
}: {
  readonly db: DatabaseClient;
  readonly endExclusiveMs: number;
}): Promise<boolean> {
  const result = (await sql<{ readonly has_one_minute: boolean }>`
    select exists(
      select 1 from candles
      where source = 'pyth'
        and product = 'spot'
        and timeframe = '1m'
        and timestamp < ${new Date(endExclusiveMs)}
      limit 1
    ) as has_one_minute
  `.execute(db)) as {
    readonly rows: readonly { readonly has_one_minute: boolean }[];
  };
  return result.rows[0]?.has_one_minute ?? false;
}

async function fetchAggregateRows({
  db,
  endExclusiveMs,
}: {
  readonly db: DatabaseClient;
  readonly endExclusiveMs: number;
}): Promise<readonly LeadTimeDriftAggregateRow[]> {
  const fiveMinuteLeads = sql.raw(
    `array[${LEAD_MINUTES_BY_PERIOD["5m"].join(",")}]::int[]`,
  );
  const fifteenMinuteLeads = sql.raw(
    `array[${LEAD_MINUTES_BY_PERIOD["15m"].join(",")}]::int[]`,
  );
  const fiveMinuteMinutes = sql.raw(
    String(
      Math.round(
        resolutionTimeframeStepMs({ timeframe: "5m" }) / millisecondsPerMinute,
      ),
    ),
  );
  const fifteenMinuteMinutes = sql.raw(
    String(
      Math.round(
        resolutionTimeframeStepMs({ timeframe: "15m" }) /
          millisecondsPerMinute,
      ),
    ),
  );
  const bps2 = sql.raw(String(LEAD_TIME_DRIFT_THRESHOLD_BPS[0] ?? 2));
  const bps5 = sql.raw(String(LEAD_TIME_DRIFT_THRESHOLD_BPS[1] ?? 5));
  const bps10 = sql.raw(String(LEAD_TIME_DRIFT_THRESHOLD_BPS[2] ?? 10));
  const result = (await sql<{
    readonly asset: Asset;
    readonly timeframe: ResolutionTimeframe;
    readonly lead_minutes: number;
    readonly sample_count: number | string;
    readonly missing_count: number | string;
    readonly signed_mean_bps: number | null;
    readonly abs_p50_bps: number | null;
    readonly abs_p75_bps: number | null;
    readonly abs_p90_bps: number | null;
    readonly abs_p99_bps: number | null;
    readonly within_bps_2: number | string;
    readonly within_bps_5: number | string;
    readonly within_bps_10: number | string;
    readonly first_candle_ts: Date | string | null;
    readonly last_candle_ts: Date | string | null;
  }>`
    with leads as (
      select '5m'::text as timeframe, unnest(${fiveMinuteLeads}) as lead_minutes
      union all
      select '15m'::text as timeframe, unnest(${fifteenMinuteLeads}) as lead_minutes
    ),
    targets as (
      select asset, timeframe, timestamp, close
      from candles
      where source = 'pyth'
        and product = 'spot'
        and timeframe in ('5m', '15m')
        and timestamp < ${new Date(endExclusiveMs)}
    ),
    joined as (
      select
        t.asset,
        t.timeframe,
        l.lead_minutes,
        t.timestamp,
        t.close as candle_close,
        one_min.close as prev_close
      from targets t
      join leads l on l.timeframe = t.timeframe
      left join candles one_min
        on one_min.source = 'pyth'
        and one_min.product = 'spot'
        and one_min.timeframe = '1m'
        and one_min.asset = t.asset
        and one_min.timestamp = t.timestamp + (
          ((case t.timeframe when '5m' then ${fiveMinuteMinutes} else ${fifteenMinuteMinutes} end) - l.lead_minutes - 1)
          * interval '1 minute'
        )
    ),
    valued as (
      select
        asset,
        timeframe,
        lead_minutes,
        timestamp,
        candle_close,
        prev_close,
        case
          when prev_close is null or candle_close is null or candle_close = 0
            then null
          else ((prev_close - candle_close) / candle_close) * 10000
        end as drift_bps
      from joined
    )
    select
      asset,
      timeframe,
      lead_minutes,
      count(*) filter (where drift_bps is not null) as sample_count,
      count(*) filter (where drift_bps is null) as missing_count,
      avg(drift_bps) filter (where drift_bps is not null) as signed_mean_bps,
      percentile_cont(0.5) within group (order by abs(drift_bps)) filter (where drift_bps is not null) as abs_p50_bps,
      percentile_cont(0.75) within group (order by abs(drift_bps)) filter (where drift_bps is not null) as abs_p75_bps,
      percentile_cont(0.9) within group (order by abs(drift_bps)) filter (where drift_bps is not null) as abs_p90_bps,
      percentile_cont(0.99) within group (order by abs(drift_bps)) filter (where drift_bps is not null) as abs_p99_bps,
      count(*) filter (where drift_bps is not null and abs(drift_bps) <= ${bps2}) as within_bps_2,
      count(*) filter (where drift_bps is not null and abs(drift_bps) <= ${bps5}) as within_bps_5,
      count(*) filter (where drift_bps is not null and abs(drift_bps) <= ${bps10}) as within_bps_10,
      min(timestamp) as first_candle_ts,
      max(timestamp) as last_candle_ts
    from valued
    group by asset, timeframe, lead_minutes
    order by asset, timeframe, lead_minutes
  `.execute(db)) as {
    readonly rows: readonly {
      readonly asset: Asset;
      readonly timeframe: ResolutionTimeframe;
      readonly lead_minutes: number;
      readonly sample_count: number | string;
      readonly missing_count: number | string;
      readonly signed_mean_bps: number | null;
      readonly abs_p50_bps: number | null;
      readonly abs_p75_bps: number | null;
      readonly abs_p90_bps: number | null;
      readonly abs_p99_bps: number | null;
      readonly within_bps_2: number | string;
      readonly within_bps_5: number | string;
      readonly within_bps_10: number | string;
      readonly first_candle_ts: Date | string | null;
      readonly last_candle_ts: Date | string | null;
    }[];
  };
  return result.rows.map((row) => ({
    asset: row.asset,
    timeframe: row.timeframe,
    leadMinutes: Number(row.lead_minutes),
    sampleCount: Number(row.sample_count),
    missingCount: Number(row.missing_count),
    signedMeanBps:
      row.signed_mean_bps === null ? null : Number(row.signed_mean_bps),
    absP50Bps: row.abs_p50_bps === null ? null : Number(row.abs_p50_bps),
    absP75Bps: row.abs_p75_bps === null ? null : Number(row.abs_p75_bps),
    absP90Bps: row.abs_p90_bps === null ? null : Number(row.abs_p90_bps),
    absP99Bps: row.abs_p99_bps === null ? null : Number(row.abs_p99_bps),
    withinBpsCounts: [
      Number(row.within_bps_2),
      Number(row.within_bps_5),
      Number(row.within_bps_10),
    ],
    firstCandleMs:
      row.first_candle_ts === null
        ? null
        : row.first_candle_ts instanceof Date
          ? row.first_candle_ts.getTime()
          : new Date(row.first_candle_ts).getTime(),
    lastCandleMs:
      row.last_candle_ts === null
        ? null
        : row.last_candle_ts instanceof Date
          ? row.last_candle_ts.getTime()
          : new Date(row.last_candle_ts).getTime(),
  }));
}
