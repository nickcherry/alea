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
    const periodMs = resolutionTimeframeStepMs({ timeframe });
    const startMs = start.getTime();
    const endMs = end.getTime();
    const result = await sql<MarketEventCandleRow>`
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

    return result.rows.map((row): Candle => {
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
    });
  };
}
