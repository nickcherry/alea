import {
  buildTradingPerformancePayload,
  type TradingPerformanceInputMarket,
  type TradingPerformanceInputTrade,
} from "@alea/lib/trading/performance/buildTradingPerformancePayload";
import type { TradingPerformancePayload } from "@alea/lib/trading/performance/types";
import type { ClobClient } from "@polymarket/clob-client-v2";
import { z } from "zod";

const MARKET_LOOKUP_CONCURRENCY = 10;
const DATA_API_HOST = "https://data-api.polymarket.com";
const DATA_API_PAGE_SIZE = 500;

export type TradingPerformanceScanProgress =
  | { readonly kind: "trades-page"; readonly tradesSoFar: number }
  | {
      readonly kind: "markets-progress";
      readonly resolved: number;
      readonly total: number;
    };

/**
 * Custom hook for tests — defaults to global `fetch`. The signature
 * matches a `RequestInit`-like minimum the implementation cares about.
 */
export type DataApiFetch = (url: string) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  json: () => Promise<unknown>;
}>;

/**
 * Builds the lifetime trading-performance payload for a Polymarket
 * trader. Trade history is sourced from the public
 * `data-api.polymarket.com/trades?user=<funder>` endpoint — the CLOB's
 * authenticated `/data/trades` endpoint only exposes the recent
 * (~24h) window for a given API key, which masks all earlier history.
 * Market resolution data still comes from the authenticated CLOB
 * client because data-api doesn't expose token-level prices /
 * winner flags.
 */
export async function scanPolymarketTradingPerformance({
  client,
  funderAddress,
  generatedAtMs = Date.now(),
  onProgress,
  dataApiFetch = async (url) => fetch(url),
}: {
  readonly client: ClobClient;
  /** Polymarket proxy/funder address — the trades' on-chain owner. */
  readonly funderAddress: string;
  readonly generatedAtMs?: number;
  readonly onProgress?: (event: TradingPerformanceScanProgress) => void;
  readonly dataApiFetch?: DataApiFetch;
}): Promise<TradingPerformancePayload> {
  const trades = await fetchAllTrades({
    funderAddress,
    onProgress,
    dataApiFetch,
  });
  const conditionIds = uniqueConditionIds({ trades });
  const markets = await fetchAllMarkets({ client, conditionIds, onProgress });
  return buildTradingPerformancePayload({
    walletAddress: funderAddress,
    generatedAtMs,
    trades: trades.map((trade, index) => toInputTrade({ trade, index })),
    markets,
  });
}

/**
 * Trade record from `data-api.polymarket.com/trades?user=...`. Fields
 * we don't read are deliberately omitted from the type so refactors
 * surface anything we'd start depending on.
 */
type RawTrade = {
  readonly proxyWallet: string;
  readonly side: string;
  readonly asset: string;
  readonly conditionId: string;
  readonly size: number;
  readonly price: number;
  readonly timestamp: number;
  readonly outcome?: string;
  readonly transactionHash?: string;
};

async function fetchAllTrades({
  funderAddress,
  onProgress,
  dataApiFetch,
}: {
  readonly funderAddress: string;
  readonly onProgress?: (event: TradingPerformanceScanProgress) => void;
  readonly dataApiFetch: DataApiFetch;
}): Promise<RawTrade[]> {
  const accumulator: RawTrade[] = [];
  let offset = 0;
  while (true) {
    const url =
      `${DATA_API_HOST}/trades?user=${encodeURIComponent(funderAddress)}` +
      `&limit=${DATA_API_PAGE_SIZE}&offset=${offset}`;
    const response = await dataApiFetch(url);
    if (!response.ok) {
      throw new Error(
        `data-api /trades returned HTTP ${response.status} for ${funderAddress}`,
      );
    }
    const body: unknown = await response.json();
    const parsed = dataApiTradesSchema.safeParse(body);
    if (!parsed.success) {
      throw new Error(
        `data-api /trades returned an unexpected shape: ${parsed.error.message}`,
      );
    }
    const page = parsed.data;
    if (page.length === 0) {
      return accumulator;
    }
    accumulator.push(...page);
    onProgress?.({
      kind: "trades-page",
      tradesSoFar: accumulator.length,
    });
    if (page.length < DATA_API_PAGE_SIZE) {
      return accumulator;
    }
    offset += DATA_API_PAGE_SIZE;
  }
}

async function fetchAllMarkets({
  client,
  conditionIds,
  onProgress,
}: {
  readonly client: ClobClient;
  readonly conditionIds: readonly string[];
  readonly onProgress?: (event: TradingPerformanceScanProgress) => void;
}): Promise<TradingPerformanceInputMarket[]> {
  const total = conditionIds.length;
  const results: TradingPerformanceInputMarket[] = [];
  let resolvedSoFar = 0;
  for (let i = 0; i < conditionIds.length; i += MARKET_LOOKUP_CONCURRENCY) {
    const slice = conditionIds.slice(i, i + MARKET_LOOKUP_CONCURRENCY);
    const settled = await Promise.allSettled(
      slice.map((conditionId) => fetchMarket({ client, conditionId })),
    );
    for (let index = 0; index < settled.length; index += 1) {
      const item = settled[index];
      const conditionId = slice[index];
      if (item?.status === "fulfilled") {
        results.push(item.value);
      } else if (conditionId !== undefined) {
        results.push(unresolvedMarket({ conditionId }));
      }
    }
    resolvedSoFar = Math.min(total, resolvedSoFar + slice.length);
    onProgress?.({
      kind: "markets-progress",
      resolved: resolvedSoFar,
      total,
    });
  }
  return results;
}

async function fetchMarket({
  client,
  conditionId,
}: {
  readonly client: ClobClient;
  readonly conditionId: string;
}): Promise<TradingPerformanceInputMarket> {
  const response: unknown = await client.getMarket(conditionId);
  const parsed = marketSchema.safeParse(response);
  if (!parsed.success) {
    return unresolvedMarket({ conditionId });
  }
  return {
    conditionId: parsed.data.condition_id ?? conditionId,
    question: parsed.data.question ?? null,
    marketSlug: parsed.data.market_slug ?? parsed.data.slug ?? null,
    endDateMs: parseDateMs(parsed.data.end_date_iso ?? null),
    closed: parsed.data.closed ?? false,
    tokens: parsed.data.tokens.map((token) => ({
      tokenId: token.token_id,
      outcome: token.outcome ?? null,
      price: token.price,
      winner: token.winner ?? false,
    })),
  };
}

function unresolvedMarket({
  conditionId,
}: {
  readonly conditionId: string;
}): TradingPerformanceInputMarket {
  return {
    conditionId,
    question: null,
    marketSlug: null,
    endDateMs: null,
    closed: false,
    tokens: [],
  };
}

function uniqueConditionIds({
  trades,
}: {
  readonly trades: readonly RawTrade[];
}): string[] {
  const set = new Set<string>();
  for (const trade of trades) {
    if (trade.conditionId.length > 0) {
      set.add(trade.conditionId);
    }
  }
  return [...set];
}

function toInputTrade({
  trade,
  index,
}: {
  readonly trade: RawTrade;
  readonly index: number;
}): TradingPerformanceInputTrade {
  // data-api doesn't return a stable trade id; transactionHash can
  // repeat across multi-leg fills in a single tx, so we suffix the
  // record's position to keep ids unique within a payload.
  const id =
    trade.transactionHash !== undefined && trade.transactionHash.length > 0
      ? `${trade.transactionHash}-${index}`
      : `trade-${index}`;
  return {
    id,
    conditionId: trade.conditionId,
    tokenId: trade.asset,
    side: trade.side === "SELL" ? "SELL" : "BUY",
    // data-api doesn't expose maker/taker — leave it unknown rather
    // than guessing. Fees fall through to 0; the dashboard's "Fees"
    // card is honest about that.
    traderSide: "UNKNOWN",
    size: Number.isFinite(trade.size) ? trade.size : 0,
    price: Number.isFinite(trade.price) ? trade.price : 0,
    feeRateBps: 0,
    tradeTimeMs: trade.timestamp * 1000,
    outcome: trade.outcome ?? null,
    transactionHash: trade.transactionHash ?? null,
  };
}

function parseDateMs(value: string | null): number | null {
  if (value === null || value.length === 0) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const numericOrNullSchema = z.preprocess((value) => {
  if (value === null || value === undefined) {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}, z.number().nullable());

const dataApiTradeSchema = z
  .object({
    proxyWallet: z.string(),
    side: z.string(),
    asset: z.string(),
    conditionId: z.string(),
    size: z.number(),
    price: z.number(),
    timestamp: z.number(),
    outcome: z.string().optional(),
    transactionHash: z.string().optional(),
  })
  .passthrough();

const dataApiTradesSchema = z.array(dataApiTradeSchema);

const marketSchema = z
  .object({
    condition_id: z.string().optional(),
    question: z.string().optional(),
    market_slug: z.string().optional(),
    slug: z.string().optional(),
    end_date_iso: z.string().nullable().optional(),
    closed: z.boolean().optional(),
    tokens: z
      .array(
        z
          .object({
            token_id: z.string(),
            outcome: z.string().optional(),
            price: numericOrNullSchema,
            winner: z.boolean().optional(),
          })
          .passthrough(),
      )
      .default([]),
  })
  .passthrough();
