import type { DatabaseClient } from "@alea/lib/db/types";
import type { PolymarketResolution } from "@alea/lib/polymarket/fetchResolution";

/**
 * Same Postgres parameter ceiling reasoning as `upsertCandles`: 65,535
 * parameters per statement, 8 columns per row here, so a 1,000-row batch
 * stays well under the ceiling.
 */
const upsertBatchSize = 1000;

export async function upsertPolymarketResolutions({
  db,
  resolutions,
  fetchedAtMs,
}: {
  readonly db: DatabaseClient;
  readonly resolutions: readonly PolymarketResolution[];
  readonly fetchedAtMs: number;
}): Promise<void> {
  if (resolutions.length === 0) {
    return;
  }

  for (let start = 0; start < resolutions.length; start += upsertBatchSize) {
    const batch = resolutions.slice(start, start + upsertBatchSize);

    await db
      .insertInto("polymarket_resolutions")
      .values(
        batch.map((row) => ({
          asset: row.asset,
          timeframe: row.timeframe,
          window_start_ts_ms: row.windowStartTsMs,
          condition_id: row.conditionId,
          outcome: row.outcome,
          uma_status: row.umaStatus,
          resolved_at_ms: row.resolvedAtMs,
          fetched_at_ms: fetchedAtMs,
        })),
      )
      .onConflict((conflict) =>
        conflict
          .columns(["asset", "timeframe", "window_start_ts_ms"])
          .doUpdateSet((eb) => ({
            condition_id: eb.ref("excluded.condition_id"),
            outcome: eb.ref("excluded.outcome"),
            uma_status: eb.ref("excluded.uma_status"),
            resolved_at_ms: eb.ref("excluded.resolved_at_ms"),
            fetched_at_ms: eb.ref("excluded.fetched_at_ms"),
          })),
      )
      .execute();
  }
}
