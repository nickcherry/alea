import {
  buildTradingPerformancePayload,
  type TradingPerformanceInputPosition,
} from "@alea/lib/trading/performance/buildTradingPerformancePayload";
import type { TradingPerformancePayload } from "@alea/lib/trading/performance/types";
import { z } from "zod";

const DATA_API_HOST = "https://data-api.polymarket.com";
const DATA_API_PAGE_SIZE = 500;

export type TradingPerformanceScanProgress = {
  readonly kind: "positions-page";
  readonly positionsSoFar: number;
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
 * trader. Position records (with realized + unrealized PnL already
 * computed by Polymarket) are pulled from the public
 * `data-api.polymarket.com/positions?user=<funder>` endpoint, which
 * is the same source feeding the Polymarket UI's portfolio view —
 * the canonical lifetime PnL for the wallet.
 *
 * `sizeThreshold=0` is required to include redeemable losing
 * positions (currentValue=0, but cashPnl reflects the loss); without
 * it the API hides them and our totals undercount losers.
 */
export async function scanPolymarketTradingPerformance({
  funderAddress,
  generatedAtMs = Date.now(),
  onProgress,
  dataApiFetch = async (url) => fetch(url),
}: {
  /** Polymarket proxy/funder address — the trades' on-chain owner. */
  readonly funderAddress: string;
  readonly generatedAtMs?: number;
  readonly onProgress?: (event: TradingPerformanceScanProgress) => void;
  readonly dataApiFetch?: DataApiFetch;
}): Promise<TradingPerformancePayload> {
  const positions = await fetchAllPositions({
    funderAddress,
    onProgress,
    dataApiFetch,
  });
  return buildTradingPerformancePayload({
    walletAddress: funderAddress,
    generatedAtMs,
    positions: positions.map(toInputPosition),
  });
}

/**
 * Position record from `data-api.polymarket.com/positions?user=...`.
 * Only the fields we actually consume are typed — extras pass
 * through harmlessly.
 */
type RawPosition = {
  readonly conditionId: string;
  readonly asset: string;
  readonly oppositeAsset?: string;
  readonly title: string;
  readonly slug?: string;
  readonly outcome: string;
  readonly size: number;
  readonly avgPrice: number;
  readonly curPrice: number;
  readonly initialValue: number;
  readonly currentValue: number;
  readonly cashPnl: number;
  readonly realizedPnl?: number;
  readonly endDate?: string;
  readonly redeemable?: boolean;
};

async function fetchAllPositions({
  funderAddress,
  onProgress,
  dataApiFetch,
}: {
  readonly funderAddress: string;
  readonly onProgress?: (event: TradingPerformanceScanProgress) => void;
  readonly dataApiFetch: DataApiFetch;
}): Promise<RawPosition[]> {
  const accumulator: RawPosition[] = [];
  let offset = 0;
  while (true) {
    const url =
      `${DATA_API_HOST}/positions?user=${encodeURIComponent(funderAddress)}` +
      `&limit=${DATA_API_PAGE_SIZE}&offset=${offset}&sizeThreshold=0`;
    const response = await dataApiFetch(url);
    if (!response.ok) {
      throw new Error(
        `data-api /positions returned HTTP ${response.status} for ${funderAddress}`,
      );
    }
    const body: unknown = await response.json();
    const parsed = dataApiPositionsSchema.safeParse(body);
    if (!parsed.success) {
      throw new Error(
        `data-api /positions returned an unexpected shape: ${parsed.error.message}`,
      );
    }
    const page = parsed.data;
    if (page.length === 0) {
      return accumulator;
    }
    accumulator.push(...page);
    onProgress?.({
      kind: "positions-page",
      positionsSoFar: accumulator.length,
    });
    if (page.length < DATA_API_PAGE_SIZE) {
      return accumulator;
    }
    offset += DATA_API_PAGE_SIZE;
  }
}

function toInputPosition(
  position: RawPosition,
): TradingPerformanceInputPosition {
  return {
    conditionId: position.conditionId,
    tokenId: position.asset,
    oppositeTokenId: position.oppositeAsset ?? null,
    title: position.title,
    slug: position.slug ?? null,
    outcome: position.outcome,
    size: numberOr({ value: position.size, fallback: 0 }),
    avgPrice: numberOr({ value: position.avgPrice, fallback: 0 }),
    currentPrice: numberOr({ value: position.curPrice, fallback: 0 }),
    initialValueUsd: numberOr({ value: position.initialValue, fallback: 0 }),
    currentValueUsd: numberOr({ value: position.currentValue, fallback: 0 }),
    cashPnlUsd: numberOr({ value: position.cashPnl, fallback: 0 }),
    realizedPnlUsd: numberOr({ value: position.realizedPnl ?? 0, fallback: 0 }),
    endDateMs: parseDateMs(position.endDate ?? null),
    redeemable: position.redeemable ?? false,
  };
}

function numberOr({
  value,
  fallback,
}: {
  readonly value: number;
  readonly fallback: number;
}): number {
  return Number.isFinite(value) ? value : fallback;
}

function parseDateMs(value: string | null): number | null {
  if (value === null || value.length === 0) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const dataApiPositionSchema = z
  .object({
    conditionId: z.string(),
    asset: z.string(),
    oppositeAsset: z.string().optional(),
    title: z.string(),
    slug: z.string().optional(),
    outcome: z.string(),
    size: z.number(),
    avgPrice: z.number(),
    curPrice: z.number(),
    initialValue: z.number(),
    currentValue: z.number(),
    cashPnl: z.number(),
    realizedPnl: z.number().optional(),
    endDate: z.string().optional(),
    redeemable: z.boolean().optional(),
  })
  .passthrough();

const dataApiPositionsSchema = z.array(dataApiPositionSchema);
