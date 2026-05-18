import type { Asset } from "@alea/types/assets";
import type { Candle, CandleTimeframe } from "@alea/types/candles";
import { z } from "zod";

const indexMinuteBaseUrl =
  "https://data-api.coindesk.com/index/cc/v1/historical/minutes";
const indexHourBaseUrl =
  "https://data-api.coindesk.com/index/cc/v1/historical/hours";
/**
 * CADLI = CoinDesk Aggregated Liquid Index. A volume-weighted multi-
 * exchange index that tracks the same kind of cross-venue aggregation
 * Chainlink's DON publishes — empirically much closer to Polymarket's
 * settlement price than any single exchange. See
 * doc/RELIABILITY_EXPERIMENT.md for the comparison context.
 */
const market = "cadli";
/**
 * CoinDesk's `historical/minutes` endpoint caps a single request to
 * 2000 underlying minute candles. With `aggregate=N` the row limit scales
 * down to `2000 / N` (5m -> 400, 15m -> 133). 1h candles use the separate
 * `historical/hours` endpoint because the minute endpoint rejects
 * `aggregate=60`.
 */
const maxUnderlyingMinutesPerPage = 2000;
const maxHourlyRowsPerPage = 2000;
const oneMinuteMs = 60_000;

type FetchCoinDeskCandlesParams = {
  readonly asset: Asset;
  readonly timeframe: CandleTimeframe;
  readonly start: Date;
  readonly end: Date;
};

/**
 * Fetches CoinDesk CADLI candles for `[start, end)`. The CADLI endpoint
 * pages newest-first via `to_ts`; we walk backward across as many pages
 * as needed and return everything in `[start, end)` in ascending
 * chronological order to match the rest of the codebase's candle
 * conventions.
 *
 * Public access works without an API key for now (rate-limited but
 * usable for our backfill volume). If we hit limits we'll need to add
 * a CoinDesk Data API credential to .env and pass it in the
 * `Authorization: Apikey ...` header.
 */
export async function fetchCoinDeskCandles({
  asset,
  timeframe,
  start,
  end,
}: FetchCoinDeskCandlesParams): Promise<readonly Candle[]> {
  const requestSpec = requestSpecForTimeframe({ timeframe });
  const startSec = Math.floor(start.getTime() / 1000);
  const endSec = Math.ceil(end.getTime() / 1000);
  const instrument = instrumentFor({ asset });
  const accumulator: Candle[] = [];
  let pageEndSec = endSec;
  while (pageEndSec > startSec) {
    const url = new URL(requestSpec.baseUrl);
    url.searchParams.set("market", market);
    url.searchParams.set("instrument", instrument);
    url.searchParams.set("limit", String(requestSpec.rowsPerPage));
    if (requestSpec.aggregate !== undefined) {
      url.searchParams.set("aggregate", String(requestSpec.aggregate));
    }
    url.searchParams.set("to_ts", String(pageEndSec));

    const response = await fetch(url.toString(), {
      headers: { "User-Agent": "alea/1.0" },
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `CoinDesk CADLI ${instrument} ${timeframe} (to_ts=${pageEndSec}) failed: ${response.status} ${body}`,
      );
    }
    const parsed = responseSchema.parse(await response.json());
    if (parsed.Data.length === 0) {
      break;
    }
    let oldestSeenSec = pageEndSec;
    for (const row of parsed.Data) {
      if (row.TIMESTAMP < startSec || row.TIMESTAMP >= endSec) {
        continue;
      }
      // CoinDesk's `aggregate=N` minute endpoint sometimes returns
      // bars whose open misaligns from the canonical N-minute boundary
      // when a request straddles the wall clock. Drop any row whose
      // TIMESTAMP isn't on a canonical boundary so we don't pollute
      // the (source, asset, product, timeframe, timestamp) primary
      // key with off-grid rows.
      if ((row.TIMESTAMP * 1000) % requestSpec.barMs !== 0) {
        continue;
      }
      accumulator.push({
        source: "coindesk",
        asset,
        product: "spot",
        timeframe,
        timestamp: new Date(row.TIMESTAMP * 1000),
        open: row.OPEN,
        high: row.HIGH,
        low: row.LOW,
        close: row.CLOSE,
        volume: row.QUOTE_VOLUME,
      });
      if (row.TIMESTAMP < oldestSeenSec) {
        oldestSeenSec = row.TIMESTAMP;
      }
    }
    if (parsed.Data.length < requestSpec.rowsPerPage) {
      break;
    }
    const nextEnd = oldestSeenSec - 1;
    if (nextEnd <= startSec) {
      break;
    }
    pageEndSec = nextEnd;
  }
  const seen = new Set<number>();
  const out: Candle[] = [];
  for (const candle of accumulator) {
    const key = candle.timestamp.getTime();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(candle);
  }
  out.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  return out;
}

function requestSpecForTimeframe({
  timeframe,
}: {
  readonly timeframe: CandleTimeframe;
}): {
  readonly baseUrl: string;
  readonly aggregate?: number;
  readonly rowsPerPage: number;
  readonly barMs: number;
} {
  switch (timeframe) {
    case "1m":
      return minuteRequestSpec({ aggregate: 1 });
    case "5m":
      return minuteRequestSpec({ aggregate: 5 });
    case "15m":
      return minuteRequestSpec({ aggregate: 15 });
    case "1h":
      return {
        baseUrl: indexHourBaseUrl,
        rowsPerPage: maxHourlyRowsPerPage,
        barMs: 60 * oneMinuteMs,
      };
    case "4h":
    case "1d":
      // Higher timeframes are fetched from Pyth (the Polymarket
      // settlement-price proxy). CoinDesk has hour/day endpoints but
      // we don't wire them up until there's a use case.
      throw new Error(
        `CoinDesk CADLI request spec not configured for ${timeframe}`,
      );
  }
}

function minuteRequestSpec({ aggregate }: { readonly aggregate: number }): {
  readonly baseUrl: string;
  readonly aggregate: number;
  readonly rowsPerPage: number;
  readonly barMs: number;
} {
  return {
    baseUrl: indexMinuteBaseUrl,
    aggregate,
    rowsPerPage: Math.floor(maxUnderlyingMinutesPerPage / aggregate),
    barMs: aggregate * oneMinuteMs,
  };
}

function instrumentFor({ asset }: { readonly asset: Asset }): string {
  return `${asset.toUpperCase()}-USD`;
}

const candleRowSchema = z
  .object({
    TIMESTAMP: z.number(),
    OPEN: z.number(),
    HIGH: z.number(),
    LOW: z.number(),
    CLOSE: z.number(),
    QUOTE_VOLUME: z.number().optional().default(0),
  })
  .passthrough();

const responseSchema = z
  .object({
    Data: z.array(candleRowSchema),
    Err: z
      .object({
        message: z.string().optional(),
      })
      .optional(),
  })
  .passthrough();
