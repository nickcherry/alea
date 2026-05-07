import type { TradeRolesByConditionId } from "@alea/lib/trading/performance/buildTradingPerformancePayload";
import type { TradingPerformanceMarketRole } from "@alea/lib/trading/performance/types";
import type { ClobClient } from "@polymarket/clob-client-v2";
import { z } from "zod";

/**
 * Per-market fill summary derived from the CLOB `/trades` endpoint:
 * which side of the book the wallet was on (maker / taker / mixed).
 *
 * `/trades` is best-effort: it silently truncates the older end of
 * the wallet's history, so older markets show up here as `undefined`
 * (and the dashboard renders them as "—"). Lifetime PnL and per-
 * market fees both come from /activity instead — see
 * `buildTradingPerformancePayload`.
 */
export async function aggregateTradeRolesByMarket({
  client,
  onProgress,
}: {
  readonly client: ClobClient;
  readonly onProgress?: (event: { readonly tradesSoFar: number }) => void;
}): Promise<TradeRolesByConditionId> {
  const trades = await fetchAllTrades({ client, onProgress });
  const aggByCondition = new Map<
    string,
    { makerCount: number; takerCount: number }
  >();
  for (const trade of trades) {
    if (trade.market.length === 0) {
      continue;
    }
    const existing = aggByCondition.get(trade.market) ?? {
      makerCount: 0,
      takerCount: 0,
    };
    if (trade.trader_side === "MAKER") {
      existing.makerCount += 1;
    } else {
      existing.takerCount += 1;
    }
    aggByCondition.set(trade.market, existing);
  }
  const out = new Map<string, { role: TradingPerformanceMarketRole }>();
  for (const [conditionId, agg] of aggByCondition) {
    const role: TradingPerformanceMarketRole =
      agg.makerCount > 0 && agg.takerCount > 0
        ? "mixed"
        : agg.makerCount > 0
          ? "maker"
          : agg.takerCount > 0
            ? "taker"
            : null;
    out.set(conditionId, { role });
  }
  return out;
}

type RawTrade = {
  readonly market: string;
  readonly size: string;
  readonly price: string;
  readonly fee_rate_bps: string;
  readonly trader_side?: string;
};

async function fetchAllTrades({
  client,
  onProgress,
}: {
  readonly client: ClobClient;
  readonly onProgress?: (event: { readonly tradesSoFar: number }) => void;
}): Promise<RawTrade[]> {
  const accumulator: RawTrade[] = [];
  let cursor: string | undefined;
  while (true) {
    const response: unknown = await client.getTradesPaginated({}, cursor);
    const parsed = paginatedTradesSchema.safeParse(response);
    if (!parsed.success) {
      throw new Error(
        `getTradesPaginated returned an unexpected shape: ${parsed.error.message}`,
      );
    }
    if (parsed.data.data.length > 0) {
      accumulator.push(...parsed.data.data);
      onProgress?.({ tradesSoFar: accumulator.length });
    }
    const next = parsed.data.next_cursor;
    if (next === undefined || next === "" || next === "LTE=") {
      return accumulator;
    }
    cursor = next;
  }
}

const rawTradeSchema = z
  .object({
    market: z.string(),
    size: z.string(),
    price: z.string(),
    fee_rate_bps: z.string(),
    trader_side: z.string().optional(),
  })
  .passthrough();

const paginatedTradesSchema = z
  .object({
    next_cursor: z.string().optional(),
    data: z.array(rawTradeSchema).optional(),
    trades: z.array(rawTradeSchema).optional(),
  })
  .passthrough()
  .refine(
    (response) => response.data !== undefined || response.trades !== undefined,
    "expected data or trades array",
  )
  .transform((response) => ({
    ...response,
    data: response.trades ?? response.data ?? [],
  }));
