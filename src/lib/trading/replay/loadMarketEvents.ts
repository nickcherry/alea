import type { DatabaseClient } from "@alea/lib/db/types";
import type {
  ReplayBaseFields,
  ReplayEvent,
} from "@alea/lib/trading/replay/types";
import type {
  MarketDataBestBidAskEvent,
  MarketDataBookEvent,
  MarketDataResolvedEvent,
  MarketDataTradeEvent,
  PriceLevel,
} from "@alea/lib/trading/vendor/types";
import { type Asset, assetSchema } from "@alea/types/assets";

/**
 * Streams parsed `market_event` rows for the requested time range as
 * `ReplayEvent`s, ordered by `(ts_ms ASC, id ASC)` — venue-time first,
 * receipt order as the tiebreaker. Out-of-shape rows (unrecognized
 * sources, malformed payloads) are silently dropped; the caller can
 * inspect counts via the returned `dropped` map but the event stream
 * itself is guaranteed-typed.
 *
 * Cursor-based: rows are pulled in 5,000-row batches so multi-day
 * replays don't materialize the entire range in memory. Postgres holds
 * the cursor open under a single read transaction for the duration.
 *
 * Source filtering happens at the SQL level — only the five sources we
 * have parsers for are fetched. Other sources (or `connect`/
 * `disconnect`/`error` markers within the recognized sources) are
 * filtered server-side to keep the cursor narrow.
 */
export type LoadMarketEventsParams = {
  readonly db: DatabaseClient;
  readonly fromMs: number;
  readonly toMs: number;
  readonly assets?: readonly Asset[];
  /**
   * Restrict the scan to a subset of event sources. Defaults to every
   * source `KIND_BY_SOURCE` knows about. Callers that only need
   * polymarket events (manifest pass) or only chainlink reference
   * prices should pass this — without it, the cursor scans every
   * captured row across all venues, which makes a multi-day replay's
   * cold start dominated by ~5× more I/O than necessary.
   */
  readonly sources?: readonly string[];
  /**
   * Restrict the scan to a subset of event kinds within the chosen
   * sources. Defaults to every kind in `KIND_BY_SOURCE` for the
   * selected sources. The manifest pass should pass
   * `["resolved", "best-bid-ask"]` (skips polymarket `book` and
   * `trade` events whose payloads dominate manifest cost — the L2
   * depth in `book` payloads alone runs ~3 KB/row, ~9.5 GB across the
   * polymarket range).
   */
  readonly kinds?: readonly string[];
  readonly batchSize?: number;
};

const DEFAULT_BATCH_SIZE = 5_000;

const KIND_BY_SOURCE: Record<string, readonly string[]> = {
  polymarket: ["book", "best-bid-ask", "trade", "resolved"],
  "binance-perp": ["bbo"],
  "coinbase-spot": ["bbo"],
  "coinbase-perp": ["bbo"],
  "polymarket-chainlink": ["reference-price"],
};

export type LoadMarketEventsResult = {
  readonly events: AsyncIterable<ReplayEvent>;
  /**
   * Lightweight counters populated as the iterable is consumed. Read
   * after the iteration finishes to spot capture-side schema drift.
   */
  readonly stats: ReplayLoadStats;
};

export type ReplayLoadStats = {
  rowsScanned: number;
  rowsParsed: number;
  rowsDropped: number;
  droppedByReason: Map<string, number>;
};

export function loadMarketEvents({
  db,
  fromMs,
  toMs,
  assets,
  sources: sourceFilter,
  kinds: kindFilter,
  batchSize = DEFAULT_BATCH_SIZE,
}: LoadMarketEventsParams): LoadMarketEventsResult {
  const stats: ReplayLoadStats = {
    rowsScanned: 0,
    rowsParsed: 0,
    rowsDropped: 0,
    droppedByReason: new Map(),
  };

  const events = (async function* (): AsyncGenerator<ReplayEvent> {
    const knownSources = Object.keys(KIND_BY_SOURCE);
    const sources =
      sourceFilter === undefined
        ? knownSources
        : sourceFilter.filter((src) => src in KIND_BY_SOURCE);
    if (sources.length === 0) {
      return;
    }
    const sourceKinds = sources.flatMap(
      (source) => KIND_BY_SOURCE[source] ?? [],
    );
    const allowedKinds =
      kindFilter === undefined
        ? sourceKinds
        : sourceKinds.filter((kind) => kindFilter.includes(kind));
    if (allowedKinds.length === 0) {
      return;
    }

    let cursorTsMs: number = fromMs;
    let cursorId: string = "";
    while (true) {
      const cursorTsMsStr = String(cursorTsMs);
      const toMsStr = String(toMs);
      let query = db
        .selectFrom("market_event")
        .select([
          "id",
          "ts_ms",
          "received_ms",
          "source",
          "asset",
          "kind",
          "market_ref",
          "payload",
        ])
        .where("source", "in", sources)
        .where("kind", "in", allowedKinds)
        .where("ts_ms", ">=", cursorTsMsStr)
        .where("ts_ms", "<=", toMsStr)
        .orderBy("ts_ms", "asc")
        .orderBy("id", "asc")
        .limit(batchSize);

      // Strict-greater-than-cursor on the (ts_ms, id) pair, expressed
      // as an OR so the index can still seek into the range cleanly.
      if (cursorId !== "") {
        const cursorIdLocal = cursorId;
        query = query.where((eb) =>
          eb.or([
            eb("ts_ms", ">", cursorTsMsStr),
            eb.and([
              eb("ts_ms", "=", cursorTsMsStr),
              eb("id", ">", cursorIdLocal),
            ]),
          ]),
        );
      }

      if (assets !== undefined && assets.length > 0) {
        // `asset` is nullable — venue-level events (polymarket
        // `resolved`, connect/disconnect markers) carry `asset = null`
        // and must NOT be filtered out by an asset whitelist. Match
        // either-or so the resolved events still flow through.
        const assetList = [...assets];
        query = query.where((eb) =>
          eb.or([eb("asset", "is", null), eb("asset", "in", assetList)]),
        );
      }

      const rows = await query.execute();
      if (rows.length === 0) {
        return;
      }

      for (const row of rows) {
        stats.rowsScanned += 1;
        const parsed = parseRow(row);
        if (parsed === null) {
          stats.rowsDropped += 1;
          continue;
        }
        stats.rowsParsed += 1;
        yield parsed;
      }

      const last = rows[rows.length - 1];
      if (last === undefined) {
        return;
      }
      cursorTsMs = Number(last.ts_ms);
      cursorId = String(last.id);
    }

    function parseRow(row: {
      id: string;
      ts_ms: string;
      received_ms: string;
      source: string;
      asset: string | null;
      kind: string;
      market_ref: string | null;
      payload: unknown;
    }): ReplayEvent | null {
      const payload = row.payload;
      if (typeof payload !== "object" || payload === null) {
        bumpDropped(stats, `payload-not-object:${row.source}/${row.kind}`);
        return null;
      }

      const base: ReplayBaseFields = {
        id: row.id,
        tsMs: Number(row.ts_ms),
        receivedMs: Number(row.received_ms),
        asset: parseAsset(row.asset),
        marketRef: row.market_ref,
      };

      if (row.source === "polymarket") {
        if (row.kind === "book") {
          const event = parsePolymarketBookPayload({ payload, atMs: base.tsMs });
          if (event === null) {
            bumpDropped(stats, "polymarket/book:malformed");
            return null;
          }
          return { ...base, source: "polymarket", kind: "book", event };
        }
        if (row.kind === "best-bid-ask") {
          const event = parsePolymarketBestBidAskPayload({
            payload,
            atMs: base.tsMs,
          });
          if (event === null) {
            bumpDropped(stats, "polymarket/best-bid-ask:malformed");
            return null;
          }
          return {
            ...base,
            source: "polymarket",
            kind: "best-bid-ask",
            event,
          };
        }
        if (row.kind === "trade") {
          const event = parsePolymarketTradePayload({
            payload,
            atMs: base.tsMs,
          });
          if (event === null) {
            bumpDropped(stats, "polymarket/trade:malformed");
            return null;
          }
          return { ...base, source: "polymarket", kind: "trade", event };
        }
        if (row.kind === "resolved") {
          const event = parsePolymarketResolvedPayload({
            payload,
            atMs: base.tsMs,
          });
          if (event === null) {
            bumpDropped(stats, "polymarket/resolved:malformed");
            return null;
          }
          return { ...base, source: "polymarket", kind: "resolved", event };
        }
      }

      if (
        (row.source === "binance-perp" ||
          row.source === "coinbase-spot" ||
          row.source === "coinbase-perp") &&
        row.kind === "bbo"
      ) {
        if (base.asset === null) {
          bumpDropped(stats, `${row.source}/bbo:no-asset`);
          return null;
        }
        const parsedBbo = parseBboPayload({ payload });
        if (parsedBbo === null) {
          bumpDropped(stats, `${row.source}/bbo:malformed`);
          return null;
        }
        return {
          ...base,
          asset: base.asset,
          source: row.source,
          kind: "bbo",
          ...parsedBbo,
        };
      }

      if (
        row.source === "polymarket-chainlink" &&
        row.kind === "reference-price"
      ) {
        if (base.asset === null) {
          bumpDropped(stats, "polymarket-chainlink/reference-price:no-asset");
          return null;
        }
        const parsedChainlink = parseChainlinkPayload({ payload });
        if (parsedChainlink === null) {
          bumpDropped(stats, "polymarket-chainlink/reference-price:malformed");
          return null;
        }
        return {
          ...base,
          asset: base.asset,
          source: "polymarket-chainlink",
          kind: "reference-price",
          ...parsedChainlink,
        };
      }

      bumpDropped(stats, `unrecognized:${row.source}/${row.kind}`);
      return null;
    }
  })();

  return { events, stats };
}

function bumpDropped(stats: ReplayLoadStats, reason: string): void {
  stats.droppedByReason.set(reason, (stats.droppedByReason.get(reason) ?? 0) + 1);
}

function parseAsset(value: string | null): Asset | null {
  if (value === null) {
    return null;
  }
  const parsed = assetSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function parsePolymarketBookPayload({
  payload,
  atMs,
}: {
  readonly payload: object;
  readonly atMs: number;
}): MarketDataBookEvent | null {
  const obj = payload as Record<string, unknown>;
  const outcomeRef = stringOrNull(obj["outcomeRef"]);
  if (outcomeRef === null) {
    return null;
  }
  const bids = parseLevels(obj["bids"]);
  const asks = parseLevels(obj["asks"]);
  return {
    kind: "book",
    vendorRef: stringOrNull(obj["vendorRef"]),
    outcomeRef,
    bids,
    asks,
    atMs: numberOr(obj["atMs"], atMs),
  };
}

function parsePolymarketBestBidAskPayload({
  payload,
  atMs,
}: {
  readonly payload: object;
  readonly atMs: number;
}): MarketDataBestBidAskEvent | null {
  const obj = payload as Record<string, unknown>;
  const outcomeRef = stringOrNull(obj["outcomeRef"]);
  if (outcomeRef === null) {
    return null;
  }
  return {
    kind: "best-bid-ask",
    vendorRef: stringOrNull(obj["vendorRef"]),
    outcomeRef,
    bestBid: nullableNumber(obj["bestBid"]),
    bestAsk: nullableNumber(obj["bestAsk"]),
    atMs: numberOr(obj["atMs"], atMs),
  };
}

function parsePolymarketTradePayload({
  payload,
  atMs,
}: {
  readonly payload: object;
  readonly atMs: number;
}): MarketDataTradeEvent | null {
  const obj = payload as Record<string, unknown>;
  const outcomeRef = stringOrNull(obj["outcomeRef"]);
  const price = nullableNumber(obj["price"]);
  if (outcomeRef === null || price === null) {
    return null;
  }
  const sideRaw = stringOrNull(obj["side"]);
  const side =
    sideRaw === "BUY" || sideRaw === "SELL" ? sideRaw : null;
  return {
    kind: "trade",
    vendorRef: stringOrNull(obj["vendorRef"]),
    outcomeRef,
    price,
    size: nullableNumber(obj["size"]),
    side,
    atMs: numberOr(obj["atMs"], atMs),
  };
}

function parsePolymarketResolvedPayload({
  payload,
  atMs,
}: {
  readonly payload: object;
  readonly atMs: number;
}): MarketDataResolvedEvent | null {
  const obj = payload as Record<string, unknown>;
  const vendorRef = stringOrNull(obj["vendorRef"]);
  if (vendorRef === null) {
    return null;
  }
  const winningSideRaw = stringOrNull(obj["winningSide"]);
  const winningSide =
    winningSideRaw === "up" || winningSideRaw === "down"
      ? winningSideRaw
      : null;
  return {
    kind: "resolved",
    vendorRef,
    winningOutcomeRef: stringOrNull(obj["winningOutcomeRef"]),
    winningSide,
    atMs: numberOr(obj["atMs"], atMs),
  };
}

function parseBboPayload({
  payload,
}: {
  readonly payload: object;
}): {
  readonly bid: number;
  readonly ask: number;
  readonly mid: number;
  readonly tsExchangeMs: number | null;
} | null {
  const obj = payload as Record<string, unknown>;
  const bid = nullableNumber(obj["bid"]);
  const ask = nullableNumber(obj["ask"]);
  const mid = nullableNumber(obj["mid"]);
  if (bid === null || ask === null || mid === null) {
    return null;
  }
  return {
    bid,
    ask,
    mid,
    tsExchangeMs: nullableNumber(obj["tsExchangeMs"]),
  };
}

function parseChainlinkPayload({
  payload,
}: {
  readonly payload: object;
}): {
  readonly value: number;
  readonly tsExchangeMs: number | null;
} | null {
  const obj = payload as Record<string, unknown>;
  const value = nullableNumber(obj["value"]);
  if (value === null) {
    return null;
  }
  return {
    value,
    tsExchangeMs: nullableNumber(obj["tsExchangeMs"]),
  };
}

function parseLevels(value: unknown): readonly PriceLevel[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: PriceLevel[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const obj = entry as Record<string, unknown>;
    const price = nullableNumber(obj["price"]);
    const size = nullableNumber(obj["size"]);
    if (price === null || size === null) {
      continue;
    }
    out.push({ price, size });
  }
  return out;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function numberOr(value: unknown, fallback: number): number {
  const parsed = nullableNumber(value);
  return parsed ?? fallback;
}
