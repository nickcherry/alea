import type { TradeDecisionPeriod } from "@alea/constants/tradeDecision";
import {
  LIVE_TRADING_MAX_ORDER_ATTEMPTS,
  LIVE_TRADING_ORDER_DEFAULT_TICK_SIZE,
  LIVE_TRADING_ORDER_MAX_QUOTE_AGE_MS,
  LIVE_TRADING_ORDER_PRICE_WINDOW,
  LIVE_TRADING_ORDER_RETRY_DELAY_MS,
  STAKE_USD,
} from "@alea/constants/trading";
import { resolutionTimeframeStepMs } from "@alea/lib/polymarket/enumerateWindowStarts";
import {
  applyMarketDataEventToMarketPriceState,
  emptyMarketPriceState,
  type MakerLimitBuyPlacement,
  type MarketDataTokenRoute,
  type MarketPriceState,
  resolveMakerLimitBuyPlacement,
  resolveTickSize,
} from "@alea/lib/trading/marketPriceState";
import type { PolymarketMarketDiscoveryCache } from "@alea/lib/trading/vendor/polymarket/marketDiscoveryCache";
import { streamPolymarketMarketData } from "@alea/lib/trading/vendor/polymarket/streamMarketData";
import type {
  MarketDataStreamHandle,
  TradableMarket,
} from "@alea/lib/trading/vendor/types";
import type { Asset } from "@alea/types/assets";
import {
  type ClobClient,
  OrderType,
  Side,
  type TickSize,
  type UserOrderV2,
} from "@polymarket/clob-client-v2";

export type LiveTradingOrderStatus =
  | "scheduled"
  | "placed"
  | "skipped_no_market"
  | "skipped_no_price"
  | "skipped_price_window"
  | "skipped_confidence"
  | "rejected";

export type LiveTradingOrderLogEvent = {
  readonly kind: "live-order";
  readonly asset: Asset;
  readonly period: TradeDecisionPeriod;
  readonly tsMs: number;
  readonly prediction: "u" | "d";
  readonly status: LiveTradingOrderStatus;
  readonly attempt: number | null;
  readonly observedPrice: number | null;
  readonly limitPrice: number | null;
  readonly confidence: number | null;
  readonly orderId: string | null;
  readonly message: string | null;
};

export type LiveTradingMarketLogEvent =
  | {
      readonly kind: "live-market";
      readonly status: "subscribed";
      readonly marketCount: number;
    }
  | {
      readonly kind: "live-market";
      readonly status: "stream-connected" | "stream-disconnected";
      readonly message: string | null;
    };

type ScheduledLiveOrder = {
  readonly key: string;
  readonly asset: Asset;
  readonly period: TradeDecisionPeriod;
  readonly prediction: "u" | "d";
  readonly targetTsMs: number;
  readonly expiresAtMs: number;
  readonly confidence: number | null;
};

type OrderSession = {
  readonly key: string;
  readonly market: TradableMarket;
  readonly state: MarketPriceState;
  readonly expiresAtMs: number;
};

type StreamMarketData = typeof streamPolymarketMarketData;

export function createLiveOrderExecutor({
  client,
  marketDiscovery,
  log,
  streamMarketData = streamPolymarketMarketData,
  now = () => Date.now(),
  sleep = defaultSleep,
}: {
  readonly client: ClobClient;
  readonly marketDiscovery: PolymarketMarketDiscoveryCache;
  readonly log: (
    event: LiveTradingOrderLogEvent | LiveTradingMarketLogEvent,
  ) => void;
  readonly streamMarketData?: StreamMarketData;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}): {
  readonly warm: (input: {
    readonly assets: readonly Asset[];
    readonly timeframes: readonly TradeDecisionPeriod[];
    readonly nowMs: number;
    readonly discoveryLeadMs: number;
  }) => void;
  readonly scheduleOrder: (input: {
    readonly asset: Asset;
    readonly period: TradeDecisionPeriod;
    readonly prediction: "u" | "d";
    readonly targetTsMs: number;
    readonly confidence: number | null;
  }) => Promise<void>;
  readonly stop: () => Promise<void>;
} {
  const sessions = new Map<string, OrderSession>();
  const tokenRoutes = new Map<string, MarketDataTokenRoute>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const scheduled = new Map<string, ScheduledLiveOrder>();
  let streamHandle: MarketDataStreamHandle | null = null;
  let stopped = false;

  const rebuildSubscription = (): void => {
    if (stopped) {
      return;
    }
    const markets: TradableMarket[] = [];
    tokenRoutes.clear();
    for (const session of sessions.values()) {
      markets.push(session.market);
      tokenRoutes.set(session.market.upRef, {
        state: session.state,
        side: "up",
      });
      tokenRoutes.set(session.market.downRef, {
        state: session.state,
        side: "down",
      });
    }

    const previous = streamHandle;
    streamHandle = null;
    if (previous !== null) {
      void previous.stop();
    }
    if (markets.length === 0) {
      return;
    }
    log({
      kind: "live-market",
      status: "subscribed",
      marketCount: markets.length,
    });
    streamHandle = streamMarketData({
      markets,
      onEvent: (event) => {
        applyMarketDataEventToMarketPriceState({ event, tokenRoutes });
      },
      onConnect: () =>
        log({ kind: "live-market", status: "stream-connected", message: null }),
      onDisconnect: (reason) =>
        log({
          kind: "live-market",
          status: "stream-disconnected",
          message: reason,
        }),
      onError: (error) =>
        log({
          kind: "live-market",
          status: "stream-disconnected",
          message: error.message,
        }),
    });
  };

  const ensureSession = ({
    market,
    key,
    expiresAtMs,
  }: {
    readonly market: TradableMarket;
    readonly key: string;
    readonly expiresAtMs: number;
  }): OrderSession => {
    const existing = sessions.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const created: OrderSession = {
      key,
      market,
      state: emptyMarketPriceState({ tickSize: market.tickSize ?? null }),
      expiresAtMs,
    };
    sessions.set(key, created);
    rebuildSubscription();
    return created;
  };

  const ensureMarketSession = async ({
    asset,
    period,
    targetTsMs,
  }: {
    readonly asset: Asset;
    readonly period: TradeDecisionPeriod;
    readonly targetTsMs: number;
  }): Promise<OrderSession | null> => {
    const key = marketKey({ asset, period, targetTsMs });
    const expiresAtMs =
      targetTsMs + resolutionTimeframeStepMs({ timeframe: period });
    const cached =
      marketDiscovery.get({
        asset,
        timeframe: period,
        windowStartTsMs: targetTsMs,
      }) ??
      (await marketDiscovery.getOrDiscover({
        asset,
        timeframe: period,
        windowStartTsMs: targetTsMs,
      }));
    if (cached === null) {
      return null;
    }
    return ensureSession({ market: cached, key, expiresAtMs });
  };

  const warm: ReturnType<typeof createLiveOrderExecutor>["warm"] = ({
    assets,
    timeframes,
    nowMs,
    discoveryLeadMs,
  }) => {
    pruneExpiredSessions({ nowMs });
    for (const timeframe of timeframes) {
      const stepMs = resolutionTimeframeStepMs({ timeframe });
      const currentStart = Math.floor(nowMs / stepMs) * stepMs;
      const nextStart = currentStart + stepMs;
      if (nowMs + discoveryLeadMs < nextStart) {
        continue;
      }
      for (const asset of assets) {
        void ensureMarketSession({
          asset,
          period: timeframe,
          targetTsMs: nextStart,
        }).catch((error) =>
          log({
            kind: "live-market",
            status: "stream-disconnected",
            message: `market warm failed ${timeframe}/${asset}: ${String(error)}`,
          }),
        );
      }
    }
  };

  const scheduleOrder: ReturnType<
    typeof createLiveOrderExecutor
  >["scheduleOrder"] = async ({
    asset,
    period,
    prediction,
    targetTsMs,
    confidence,
  }) => {
    if (stopped) {
      return;
    }
    const key = marketKey({ asset, period, targetTsMs });
    if (scheduled.has(key)) {
      return;
    }
    const expiresAtMs =
      targetTsMs + resolutionTimeframeStepMs({ timeframe: period });
    const order: ScheduledLiveOrder = {
      key,
      asset,
      period,
      prediction,
      targetTsMs,
      expiresAtMs,
      confidence,
    };
    scheduled.set(key, order);
    void ensureMarketSession({ asset, period, targetTsMs }).catch(() => null);
    logOrder({ order, status: "scheduled", attempt: null });

    const delayMs = Math.max(0, targetTsMs - now());
    const timer = setTimeout(() => {
      timers.delete(key);
      void placeScheduledOrder({ order }).finally(() => {
        scheduled.delete(key);
      });
    }, delayMs);
    timers.set(key, timer);
  };

  const placeScheduledOrder = async ({
    order,
  }: {
    readonly order: ScheduledLiveOrder;
  }): Promise<void> => {
    for (
      let attempt = 1;
      attempt <= LIVE_TRADING_MAX_ORDER_ATTEMPTS;
      attempt++
    ) {
      if (stopped) {
        return;
      }
      const session = await ensureMarketSession({
        asset: order.asset,
        period: order.period,
        targetTsMs: order.targetTsMs,
      });
      if (session === null) {
        if (attempt === LIVE_TRADING_MAX_ORDER_ATTEMPTS) {
          logOrder({
            order,
            status: "skipped_no_market",
            attempt,
            message: "target market was not discovered before placement",
          });
          return;
        }
        await sleep(LIVE_TRADING_ORDER_RETRY_DELAY_MS);
        continue;
      }

      const placement = resolveMakerLimitBuyPlacement({
        prediction: order.prediction,
        state: session.state,
        nowMs: now(),
        confidence: order.confidence,
        priceWindow: LIVE_TRADING_ORDER_PRICE_WINDOW,
        maxQuoteAgeMs: LIVE_TRADING_ORDER_MAX_QUOTE_AGE_MS,
        defaultTickSize: LIVE_TRADING_ORDER_DEFAULT_TICK_SIZE,
      });
      if (placement.status === "no_price") {
        if (attempt === LIVE_TRADING_MAX_ORDER_ATTEMPTS) {
          logOrder({
            order,
            status: "skipped_no_price",
            attempt,
            message: "no fresh predicted-side ask",
          });
          return;
        }
        await sleep(LIVE_TRADING_ORDER_RETRY_DELAY_MS);
        continue;
      }
      if (placement.status === "price_window") {
        logOrder({
          order,
          status: "skipped_price_window",
          attempt,
          placement,
        });
        return;
      }
      if (placement.status === "confidence") {
        logOrder({
          order,
          status: "skipped_confidence",
          attempt,
          placement,
        });
        return;
      }

      const request = buildLiveMakerLimitBuyOrder({
        market: session.market,
        period: order.period,
        prediction: order.prediction,
        targetTsMs: order.targetTsMs,
        limitPrice: placement.limitPrice,
      });
      try {
        const response = await client.createAndPostOrder(
          request.userOrder,
          request.options,
          OrderType.GTD,
          true,
        );
        const postError = extractPostOrderError(response);
        if (postError === null) {
          logOrder({
            order,
            status: "placed",
            attempt,
            placement,
            orderId: extractOrderId(response),
            message: previewResponse(response),
          });
          return;
        }
        if (attempt === LIVE_TRADING_MAX_ORDER_ATTEMPTS) {
          logOrder({
            order,
            status: "rejected",
            attempt,
            placement,
            message: postError,
          });
          return;
        }
      } catch (error) {
        if (attempt === LIVE_TRADING_MAX_ORDER_ATTEMPTS) {
          logOrder({
            order,
            status: "rejected",
            attempt,
            placement,
            message: error instanceof Error ? error.message : String(error),
          });
          return;
        }
      }
      await sleep(LIVE_TRADING_ORDER_RETRY_DELAY_MS);
    }
  };

  const pruneExpiredSessions = ({
    nowMs,
  }: {
    readonly nowMs: number;
  }): void => {
    let changed = false;
    for (const [key, session] of sessions.entries()) {
      if (nowMs <= session.expiresAtMs + 5_000) {
        continue;
      }
      sessions.delete(key);
      changed = true;
    }
    if (changed) {
      rebuildSubscription();
    }
  };

  return {
    warm,
    scheduleOrder,
    async stop(): Promise<void> {
      stopped = true;
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
      scheduled.clear();
      const handle = streamHandle;
      streamHandle = null;
      if (handle !== null) {
        await handle.stop();
      }
    },
  };

  function logOrder({
    order,
    status,
    attempt,
    placement,
    orderId = null,
    message = null,
  }: {
    readonly order: ScheduledLiveOrder;
    readonly status: LiveTradingOrderStatus;
    readonly attempt: number | null;
    readonly placement?: Exclude<
      MakerLimitBuyPlacement,
      { status: "no_price" }
    >;
    readonly orderId?: string | null;
    readonly message?: string | null;
  }): void {
    log({
      kind: "live-order",
      asset: order.asset,
      period: order.period,
      tsMs: order.targetTsMs,
      prediction: order.prediction,
      status,
      attempt,
      observedPrice: placement?.observedPrice ?? null,
      limitPrice: placement?.limitPrice ?? null,
      confidence: placement?.confidence ?? order.confidence,
      orderId,
      message,
    });
  }
}

export function buildLiveMakerLimitBuyOrder({
  market,
  period,
  prediction,
  targetTsMs,
  limitPrice,
}: {
  readonly market: TradableMarket;
  readonly period: TradeDecisionPeriod;
  readonly prediction: "u" | "d";
  readonly targetTsMs: number;
  readonly limitPrice: number;
}): {
  readonly userOrder: UserOrderV2;
  readonly options: { readonly tickSize: TickSize; readonly negRisk?: boolean };
} {
  const tokenID = prediction === "u" ? market.upRef : market.downRef;
  const periodMs = resolutionTimeframeStepMs({ timeframe: period });
  const userOrder: UserOrderV2 = {
    tokenID,
    price: limitPrice,
    size: roundShareSize(STAKE_USD / limitPrice),
    side: Side.BUY,
    expiration: Math.floor((targetTsMs + periodMs) / 1_000),
  };
  return {
    userOrder,
    options: {
      tickSize: toPolymarketTickSize(
        resolveTickSize({
          tickSize: market.tickSize ?? null,
          defaultTickSize: LIVE_TRADING_ORDER_DEFAULT_TICK_SIZE,
        }),
      ),
      ...(market.negRisk === undefined || market.negRisk === null
        ? {}
        : { negRisk: market.negRisk }),
    },
  };
}

function toPolymarketTickSize(value: number): TickSize {
  if (Math.abs(value - 0.1) < 1e-9) {
    return "0.1";
  }
  if (Math.abs(value - 0.001) < 1e-9) {
    return "0.001";
  }
  if (Math.abs(value - 0.0001) < 1e-9) {
    return "0.0001";
  }
  return "0.01";
}

function roundShareSize(value: number): number {
  return Number(value.toFixed(4));
}

function extractPostOrderError(response: unknown): string | null {
  if (response === null || typeof response !== "object") {
    return null;
  }
  const record = response as Record<string, unknown>;
  if (record["success"] === false) {
    return (
      extractResponseMessage(response) ?? "order post returned success=false"
    );
  }
  if (record["error"] !== undefined && record["error"] !== null) {
    return (
      extractResponseMessage(response) ?? unknownToMessage(record["error"])
    );
  }
  return null;
}

function extractOrderId(response: unknown): string | null {
  if (response === null || typeof response !== "object") {
    return null;
  }
  const record = response as Record<string, unknown>;
  for (const key of ["orderID", "orderId", "id", "hash"]) {
    if (key in record) {
      const value = record[key];
      if (typeof value === "string" && value.length > 0) {
        return value;
      }
    }
  }
  return null;
}

function extractResponseMessage(response: object): string | null {
  const record = response as Record<string, unknown>;
  for (const key of ["error", "message", "detail"]) {
    if (key in record) {
      const value = record[key];
      if (typeof value === "string" && value.length > 0) {
        return value;
      }
    }
  }
  return null;
}

function previewResponse(response: unknown): string | null {
  if (response === null || response === undefined) {
    return null;
  }
  const text =
    typeof response === "string" ? response : JSON.stringify(response);
  return text.length <= 240 ? text : `${text.slice(0, 240)}...`;
}

function unknownToMessage(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function marketKey({
  asset,
  period,
  targetTsMs,
}: {
  readonly asset: Asset;
  readonly period: TradeDecisionPeriod;
  readonly targetTsMs: number;
}): string {
  return `${asset}:${period}:${targetTsMs}`;
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
