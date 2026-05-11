import {
  buildTradingPerformancePayload,
  type TradeRolesByConditionId,
  type TradingPerformanceInputActivity,
  type TradingPerformanceInputPosition,
} from "@alea/lib/trading/performance/buildTradingPerformancePayload";
import type { TradingPerformancePayload } from "@alea/lib/trading/performance/types";
import { aggregateTradeRolesByMarket } from "@alea/lib/trading/vendor/polymarket/aggregateTradeRolesByMarket";
import type { ClobClient } from "@polymarket/clob-client-v2";
import { z } from "zod";

const DATA_API_HOST = "https://data-api.polymarket.com";
const DATA_API_PAGE_SIZE = 500;

export type TradingPerformanceScanProgress =
  | { readonly kind: "activity-page"; readonly activitiesSoFar: number }
  | { readonly kind: "positions-page"; readonly positionsSoFar: number }
  | { readonly kind: "trades-page"; readonly tradesSoFar: number };

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
 * Builds the lifetime trading-performance payload by combining the
 * Polymarket activity ledger (cashflow ground truth: BUY / REDEEM /
 * SELL / MAKER_REBATE / SPLIT / MERGE) with the current `/positions`
 * snapshot (mark-to-market for unsettled markets). This is the same
 * data feeding Polymarket's profile UI.
 *
 * Why activity, not /trades or just /positions:
 * - /trades is missing many older fills (silently truncates).
 * - /positions only contains currently-held + redeemable losers; auto-
 *   redeemed winners drop out, which biases sums toward losses.
 * - /activity records every redemption event so we can reconstruct
 *   realized PnL even for already-redeemed winners.
 */
export async function scanPolymarketTradingPerformance({
  funderAddress,
  generatedAtMs = Date.now(),
  onProgress,
  dataApiFetch = async (url) => fetch(url),
  clobClient,
}: {
  /** Polymarket proxy/funder address — the trades' on-chain owner. */
  readonly funderAddress: string;
  readonly generatedAtMs?: number;
  readonly onProgress?: (event: TradingPerformanceScanProgress) => void;
  readonly dataApiFetch?: DataApiFetch;
  /**
   * Optional authenticated CLOB client. When provided, the scan also
   * fetches `/trades` and enriches each market row with the wallet's
   * fill role (maker / taker / mixed) and fees paid. The dashboard
   * builder passes this; `trading:hydrate-lifetime-pnl` doesn't (it
   * only needs the lifetime PnL scalar).
   */
  readonly clobClient?: ClobClient;
}): Promise<TradingPerformancePayload> {
  const [activity, positions, tradeRolesByConditionId] = await Promise.all([
    fetchAllActivity({ funderAddress, onProgress, dataApiFetch }),
    fetchAllPositions({ funderAddress, onProgress, dataApiFetch }),
    fetchTradeRoles({ clobClient, onProgress }),
  ]);
  return buildTradingPerformancePayload({
    walletAddress: funderAddress,
    generatedAtMs,
    activity: activity.map(toInputActivity),
    positions: positions.map(toInputPosition),
    tradeRolesByConditionId,
  });
}

async function fetchTradeRoles({
  clobClient,
  onProgress,
}: {
  readonly clobClient: ClobClient | undefined;
  readonly onProgress?: (event: TradingPerformanceScanProgress) => void;
}): Promise<TradeRolesByConditionId | undefined> {
  if (clobClient === undefined) {
    return undefined;
  }
  return aggregateTradeRolesByMarket({
    client: clobClient,
    onProgress: (event) => {
      onProgress?.({ kind: "trades-page", tradesSoFar: event.tradesSoFar });
    },
  });
}

type RawActivity = {
  readonly type: string;
  readonly side?: string;
  readonly conditionId?: string;
  readonly title?: string;
  readonly slug?: string;
  readonly outcome?: string;
  readonly usdcSize: number;
  readonly size?: number;
  readonly price?: number;
  readonly timestamp: number;
};

type RawPosition = {
  readonly conditionId: string;
  readonly title?: string;
  readonly slug?: string;
  readonly outcome?: string;
  readonly size: number;
  readonly curPrice: number;
  readonly currentValue: number;
  readonly endDate?: string;
  readonly redeemable?: boolean;
};

async function fetchAllActivity({
  funderAddress,
  onProgress,
  dataApiFetch,
}: {
  readonly funderAddress: string;
  readonly onProgress?: (event: TradingPerformanceScanProgress) => void;
  readonly dataApiFetch: DataApiFetch;
}): Promise<RawActivity[]> {
  const accumulator: RawActivity[] = [];
  let offset = 0;
  while (true) {
    const url =
      `${DATA_API_HOST}/activity?user=${encodeURIComponent(funderAddress)}` +
      `&limit=${DATA_API_PAGE_SIZE}&offset=${offset}`;
    const response = await dataApiFetch(url);
    if (!response.ok) {
      throw new Error(
        `data-api /activity returned HTTP ${response.status} for ${funderAddress}`,
      );
    }
    const body: unknown = await response.json();
    const parsed = activityArraySchema.safeParse(body);
    if (!parsed.success) {
      throw new Error(
        `data-api /activity returned an unexpected shape: ${parsed.error.message}`,
      );
    }
    const page = parsed.data;
    if (page.length === 0) {
      return accumulator;
    }
    accumulator.push(...page);
    onProgress?.({
      kind: "activity-page",
      activitiesSoFar: accumulator.length,
    });
    if (page.length < DATA_API_PAGE_SIZE) {
      return accumulator;
    }
    offset += DATA_API_PAGE_SIZE;
  }
}

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
    const parsed = positionsArraySchema.safeParse(body);
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

function toInputActivity(
  activity: RawActivity,
): TradingPerformanceInputActivity {
  return {
    kind: parseActivityKind({ value: activity.type }),
    side: parseActivitySide({ value: activity.side }),
    conditionId: activity.conditionId ?? null,
    title: activity.title ?? null,
    slug: activity.slug ?? null,
    outcome: activity.outcome ?? null,
    usdcSize: numberOr({ value: activity.usdcSize, fallback: 0 }),
    size: numberOr({ value: activity.size ?? 0, fallback: 0 }),
    price: numberOr({ value: activity.price ?? 0, fallback: 0 }),
    timestampMs: activity.timestamp * 1000,
  };
}

function toInputPosition(
  position: RawPosition,
): TradingPerformanceInputPosition {
  return {
    conditionId: position.conditionId,
    title: position.title ?? null,
    slug: position.slug ?? null,
    outcome: position.outcome ?? null,
    size: numberOr({ value: position.size, fallback: 0 }),
    currentPrice: numberOr({ value: position.curPrice, fallback: 0 }),
    currentValueUsd: numberOr({ value: position.currentValue, fallback: 0 }),
    endDateMs: parseDateMs(position.endDate ?? null),
    redeemable: position.redeemable ?? false,
  };
}

/**
 * Maps the API's `type` string into our enum. Unknown types fall
 * through to TRADE so they don't blow up the pipeline; the build
 * step's `directionForActivity` ignores TRADEs without a clear side,
 * so the cashflow stays untouched.
 */
function parseActivityKind({
  value,
}: {
  readonly value: string;
}): TradingPerformanceInputActivity["kind"] {
  if (
    value === "TRADE" ||
    value === "REDEEM" ||
    value === "MAKER_REBATE" ||
    value === "SPLIT" ||
    value === "MERGE"
  ) {
    return value;
  }
  return "TRADE";
}

function parseActivitySide({
  value,
}: {
  readonly value: string | undefined;
}): TradingPerformanceInputActivity["side"] {
  if (value === "BUY" || value === "SELL") {
    return value;
  }
  return null;
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

const activitySchema = z
  .object({
    type: z.string(),
    side: z.string().optional(),
    conditionId: z.string().optional(),
    title: z.string().optional(),
    slug: z.string().optional(),
    outcome: z.string().optional(),
    usdcSize: z.number(),
    size: z.number().optional(),
    price: z.number().optional(),
    timestamp: z.number(),
  })
  .passthrough();

const positionSchema = z
  .object({
    conditionId: z.string(),
    title: z.string().optional(),
    slug: z.string().optional(),
    outcome: z.string().optional(),
    size: z.number(),
    curPrice: z.number(),
    currentValue: z.number(),
    endDate: z.string().optional(),
    redeemable: z.boolean().optional(),
  })
  .passthrough();

const activityArraySchema = z.array(activitySchema);
const positionsArraySchema = z.array(positionSchema);
