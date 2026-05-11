import type { DatabaseClient } from "@alea/lib/db/types";
import {
  enumerateResolutionWindowStarts,
  resolutionTimeframeStepMs,
} from "@alea/lib/polymarket/enumerateWindowStarts";
import {
  fetchPolymarketResolution,
  type PolymarketResolution,
} from "@alea/lib/polymarket/fetchResolution";
import { upsertPolymarketResolutions } from "@alea/lib/polymarket/upsertResolutions";
import type { Asset } from "@alea/types/assets";
import type { ResolutionTimeframe } from "@alea/types/resolutions";
import { sql } from "kysely";

const flushBatchSize = 200;

export type SyncResolutionsProgressEvent =
  | {
      readonly kind: "task-start";
      readonly asset: Asset;
      readonly timeframe: ResolutionTimeframe;
      readonly windowCount: number;
      readonly alreadyStoredCount: number;
    }
  | {
      readonly kind: "task-done";
      readonly asset: Asset;
      readonly timeframe: ResolutionTimeframe;
      readonly resolved: number;
      readonly pending: number;
      readonly missing: number;
      readonly voided: number;
      readonly errors: number;
      readonly elapsedMs: number;
    };

export type SyncResolutionsResult = {
  readonly asset: Asset;
  readonly timeframe: ResolutionTimeframe;
  readonly resolved: number;
  readonly pending: number;
  readonly missing: number;
  readonly voided: number;
  readonly errors: number;
  readonly elapsedMs: number;
};

/**
 * Walks the `[start, end)` window grid for `(asset, timeframe)`, skipping
 * windows already stored, and fetches each missing slug from the gamma-api
 * with bounded concurrency. Resolved markets are upserted in flushes of
 * `flushBatchSize`; pending markets are left for a later pass; missing
 * windows are silently skipped so we don't store rows for slots that
 * never existed (asset not listed yet, Polymarket pruned old windows,
 * etc.).
 *
 * Returns aggregate counts so the CLI can report per-task progress.
 */
export async function syncPolymarketResolutions({
  db,
  asset,
  timeframe,
  start,
  end,
  concurrency,
  onProgress,
  signal,
}: {
  readonly db: DatabaseClient;
  readonly asset: Asset;
  readonly timeframe: ResolutionTimeframe;
  readonly start: Date;
  readonly end: Date;
  readonly concurrency: number;
  readonly onProgress?: (event: SyncResolutionsProgressEvent) => void;
  readonly signal?: AbortSignal;
}): Promise<SyncResolutionsResult> {
  const stepMs = resolutionTimeframeStepMs({ timeframe });
  const windowStartTsMs = enumerateResolutionWindowStarts({
    start,
    end,
    stepMs,
  });
  const alreadyStored = await loadStoredWindowKeys({
    db,
    asset,
    timeframe,
    startMs: start.getTime(),
    endMs: end.getTime(),
  });
  const pending: number[] = [];
  for (const ts of windowStartTsMs) {
    if (!alreadyStored.has(ts)) {
      pending.push(ts);
    }
  }

  onProgress?.({
    kind: "task-start",
    asset,
    timeframe,
    windowCount: windowStartTsMs.length,
    alreadyStoredCount: alreadyStored.size,
  });

  const beganAt = performance.now();
  let cursor = 0;
  let resolved = 0;
  let pendingCount = 0;
  let missing = 0;
  let voided = 0;
  let errors = 0;
  const buffer: PolymarketResolution[] = [];

  const flush = async (): Promise<void> => {
    if (buffer.length === 0) {
      return;
    }
    const batch = buffer.splice(0, buffer.length);
    await upsertPolymarketResolutions({
      db,
      resolutions: batch,
      fetchedAtMs: Date.now(),
    });
  };

  const worker = async (): Promise<void> => {
    while (cursor < pending.length) {
      const idx = cursor++;
      const ts = pending[idx];
      if (ts === undefined) {
        continue;
      }
      if (signal?.aborted) {
        return;
      }
      try {
        const result = await fetchPolymarketResolution({
          asset,
          timeframe,
          windowStartTsMs: ts,
          signal,
        });
        if (result.kind === "resolved") {
          resolved += 1;
          if (result.resolution.outcome === "void") {
            voided += 1;
          }
          buffer.push(result.resolution);
          if (buffer.length >= flushBatchSize) {
            await flush();
          }
        } else if (result.kind === "pending") {
          pendingCount += 1;
        } else {
          missing += 1;
        }
      } catch {
        errors += 1;
      }
    }
  };

  try {
    await Promise.all(
      Array.from({ length: Math.min(concurrency, Math.max(1, pending.length)) },
        () => worker(),
      ),
    );
    await flush();
  } catch (err) {
    await flush();
    throw err;
  }

  const elapsedMs = performance.now() - beganAt;
  onProgress?.({
    kind: "task-done",
    asset,
    timeframe,
    resolved,
    pending: pendingCount,
    missing,
    voided,
    errors,
    elapsedMs,
  });
  return {
    asset,
    timeframe,
    resolved,
    pending: pendingCount,
    missing,
    voided,
    errors,
    elapsedMs,
  };
}

async function loadStoredWindowKeys({
  db,
  asset,
  timeframe,
  startMs,
  endMs,
}: {
  readonly db: DatabaseClient;
  readonly asset: Asset;
  readonly timeframe: ResolutionTimeframe;
  readonly startMs: number;
  readonly endMs: number;
}): Promise<Set<number>> {
  const rows = await sql<{ ts: string }>`
    select window_start_ts_ms as ts
    from polymarket_resolutions
    where asset = ${asset}
      and timeframe = ${timeframe}
      and window_start_ts_ms >= ${startMs}
      and window_start_ts_ms < ${endMs}
  `.execute(db);
  const set = new Set<number>();
  for (const row of rows.rows) {
    set.add(Number(row.ts));
  }
  return set;
}
