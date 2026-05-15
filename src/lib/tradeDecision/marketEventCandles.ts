import type { DatabaseClient } from "@alea/lib/db/types";
import { resolutionTimeframeStepMs } from "@alea/lib/polymarket/enumerateWindowStarts";
import type { FetchCandles } from "@alea/lib/tradeDecision/candleState";
import type { Asset } from "@alea/types/assets";
import type { Candle } from "@alea/types/candles";
import { sql } from "kysely";

type MarketEventCandleRow = {
  readonly open_ms: string;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
};

export function createMarketEventPythCandleFetcher({
  db,
}: {
  readonly db: DatabaseClient;
}): FetchCandles {
  return async ({ asset, timeframe, start, end }) => {
    const storedRows = await db
      .selectFrom("candles")
      .select(["timestamp", "open", "high", "low", "close", "volume"])
      .where("source", "=", "pyth")
      .where("product", "=", "spot")
      .where("asset", "=", asset)
      .where("timeframe", "=", timeframe)
      .where("timestamp", ">=", start)
      .where("timestamp", "<", end)
      .orderBy("timestamp", "asc")
      .execute();
    const periodMs = resolutionTimeframeStepMs({ timeframe });
    const startMs = start.getTime();
    const endMs = end.getTime();
    const eventResult = await sql<MarketEventCandleRow>`
      with ticks as (
        select
          (floor(ts_ms::numeric / ${periodMs}) * ${periodMs})::bigint as open_ms,
          ts_ms::bigint as ts_ms,
          (payload->>'mid')::double precision as price
        from market_event
        where source = 'pyth-spot'
          and kind = 'bbo'
          and asset = ${asset}
          and ts_ms >= ${startMs}
          and ts_ms < ${endMs}
          and payload->>'mid' is not null
      )
      select
        open_ms::text as open_ms,
        (array_agg(price order by ts_ms asc))[1] as open,
        max(price) as high,
        min(price) as low,
        (array_agg(price order by ts_ms desc))[1] as close
      from ticks
      group by open_ms
      order by open_ms asc
    `.execute(db);

    return mergeStoredAndEventCandles({
      stored: storedRows.map((row) => ({
        source: "pyth",
        asset,
        product: "spot",
        timeframe,
        timestamp: row.timestamp,
        open: Number(row.open),
        high: Number(row.high),
        low: Number(row.low),
        close: Number(row.close),
        volume: Number(row.volume),
      })),
      events: eventResult.rows.map((row): Candle => {
        const timestamp = new Date(Number(row.open_ms));
        return {
          source: "pyth",
          asset: asset as Asset,
          product: "spot",
          timeframe,
          timestamp,
          open: Number(row.open),
          high: Number(row.high),
          low: Number(row.low),
          close: Number(row.close),
          volume: 0,
        };
      }),
    });
  };
}

export function mergeStoredAndEventCandles({
  stored,
  events,
}: {
  readonly stored: readonly Candle[];
  readonly events: readonly Candle[];
}): readonly Candle[] {
  const byTimestamp = new Map<number, Candle>();
  for (const candle of stored) {
    byTimestamp.set(candle.timestamp.getTime(), candle);
  }
  for (const candle of events) {
    byTimestamp.set(candle.timestamp.getTime(), candle);
  }
  return [...byTimestamp.values()].sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
  );
}
