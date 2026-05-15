import type { TradeDecisionPeriod } from "@alea/constants/tradeDecision";
import {
  LIVE_TRADING_MAX_ORDER_ATTEMPTS,
  LIVE_TRADING_ORDER_DEFAULT_TICK_SIZE,
  LIVE_TRADING_ORDER_MAX_QUOTE_AGE_MS,
  LIVE_TRADING_ORDER_MAX_RETRY_DELAY_MS,
  LIVE_TRADING_ORDER_MIN_RETRY_WINDOW_MS,
  LIVE_TRADING_ORDER_NO_QUOTE_REFERENCE_PRICE,
  LIVE_TRADING_ORDER_PRICE_WINDOW,
  LIVE_TRADING_ORDER_RATE_LIMIT_RETRY_BASE_MS,
  LIVE_TRADING_ORDER_RETRY_AFTER_OPEN_MS,
  LIVE_TRADING_ORDER_RETRY_DELAY_MS,
  LIVE_TRADING_ORDER_TRANSIENT_RETRY_BASE_MS,
  LIVE_TRADING_SESSION_GRACE_MS,
  STAKE_USD,
} from "@alea/constants/trading";
import { resolutionTimeframeStepMs } from "@alea/lib/polymarket/enumerateWindowStarts";
import {
  applyMarketDataEventToMarketPriceState,
  emptyMarketPriceState,
  type MakerLimitBuyPlacement,
  type MarketDataTokenRoute,
  type MarketPriceState,
  predictedSideOneTickBelowReferencePrice,
  resolveMakerLimitBuyPlacement,
  resolveTickSize,
  roundDownToTick,
  summarizePredictedSideBook,
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
  | "attempting"
  | "placed"
  | "skipped_no_market"
  | "skipped_no_price"
  | "skipped_price_window"
  | "skipped_confidence"
  | "rejected";

export type LiveTradingOrderFailureKind =
  | "post_only_cross"
  | "rate_limited"
  | "not_ready"
  | "not_found"
  | "server_error"
  | "auth"
  | "balance_or_allowance"
  | "invalid_order"
  | "closed_or_banned"
  | "network_or_unknown"
  | "terminal"
  | "unknown";

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
  readonly marketRef: string | null;
  readonly tokenRef: string | null;
  readonly oppositeTokenRef: string | null;
  readonly failureStatus: number | null;
  readonly failureKind: LiveTradingOrderFailureKind | null;
  readonly postDurationMs: number | null;
  readonly predictedBestBid: number | null;
  readonly predictedBestAsk: number | null;
  readonly predictedSpread: number | null;
  readonly predictedBidAgeMs: number | null;
  readonly predictedAskAgeMs: number | null;
  readonly predictedBookAgeMs: number | null;
  readonly predictedBidLevels: number | null;
  readonly predictedAskLevels: number | null;
  readonly predictedBidDepthAtLimitUsd: number | null;
  readonly predictedBidDepthAboveLimitUsd: number | null;
  readonly predictedBidDepthAtOrAboveLimitUsd: number | null;
  readonly predictedAskDepthAtBestUsd: number | null;
  readonly predictedAskDepthWithin1cUsd: number | null;
  readonly predictedAskDepthWithin2cUsd: number | null;
  readonly oppositeBestBid: number | null;
  readonly oppositeBestAsk: number | null;
  readonly oppositeSpread: number | null;
  readonly message: string | null;
};

type LiveTradingErrorLogEvent = {
  readonly kind: "error";
  readonly message: string;
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
    event:
      | LiveTradingOrderLogEvent
      | LiveTradingMarketLogEvent
      | LiveTradingErrorLogEvent,
  ) => void;
  readonly streamMarketData?: StreamMarketData;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}): {
  readonly warm: (input: {
    readonly markets: readonly {
      readonly asset: Asset;
      readonly period: TradeDecisionPeriod;
    }[];
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
    markets,
    nowMs,
    discoveryLeadMs,
  }) => {
    pruneExpiredSessions({ nowMs });
    for (const { asset, period } of markets) {
      const stepMs = resolutionTimeframeStepMs({ timeframe: period });
      const currentStart = Math.floor(nowMs / stepMs) * stepMs;
      const nextStart = currentStart + stepMs;
      if (nowMs + discoveryLeadMs < nextStart) {
        continue;
      }
      void ensureMarketSession({
        asset,
        period,
        targetTsMs: nextStart,
      }).catch((error) =>
        log({
          kind: "live-market",
          status: "stream-disconnected",
          message: `market warm failed ${period}/${asset}: ${String(error)}`,
        }),
      );
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
    void placeScheduledOrder({ order })
      .catch((error) => {
        log({
          kind: "error",
          message: `live order placement failed ${period}/${asset}: ${String(error)}`,
        });
      })
      .finally(() => {
        scheduled.delete(key);
      });
  };

  const placeScheduledOrder = async ({
    order,
  }: {
    readonly order: ScheduledLiveOrder;
  }): Promise<void> => {
    const retryUntilMs = orderRetryUntilMs({
      order,
      nowMs: now(),
    });
    let postOnlyLimitCap: number | null = null;
    try {
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
          if (
            !shouldRetryOrderPlacement({
              attempt,
              retryUntilMs,
              nowMs: now(),
            })
          ) {
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
          fallbackLimitPrice: predictedSideOneTickBelowReferencePrice({
            prediction: order.prediction,
            state: session.state,
            referencePrice: LIVE_TRADING_ORDER_NO_QUOTE_REFERENCE_PRICE,
            defaultTickSize: LIVE_TRADING_ORDER_DEFAULT_TICK_SIZE,
          }),
        });
        const cappedPlacement = applyPostOnlyLimitCap({
          placement,
          maxLimitPrice: postOnlyLimitCap,
          tickSize: resolveTickSize({
            tickSize: session.market.tickSize ?? null,
            defaultTickSize: LIVE_TRADING_ORDER_DEFAULT_TICK_SIZE,
          }),
          priceWindow: LIVE_TRADING_ORDER_PRICE_WINDOW,
        });
        if (cappedPlacement.status === "no_price") {
          if (
            !shouldRetryOrderPlacement({
              attempt,
              retryUntilMs,
              nowMs: now(),
            })
          ) {
            logOrder({
              order,
              status: "skipped_no_price",
              attempt,
              session,
              message: "no fresh predicted-side ask",
            });
            return;
          }
          await sleep(LIVE_TRADING_ORDER_RETRY_DELAY_MS);
          continue;
        }
        if (cappedPlacement.status === "price_window") {
          logOrder({
            order,
            status: "skipped_price_window",
            attempt,
            placement: cappedPlacement,
            session,
          });
          return;
        }
        const request = buildLiveMakerLimitBuyOrder({
          market: session.market,
          period: order.period,
          prediction: order.prediction,
          targetTsMs: order.targetTsMs,
          limitPrice: cappedPlacement.limitPrice,
        });
        logOrder({
          order,
          status: "attempting",
          attempt,
          placement: cappedPlacement,
          session,
        });
        let retryDelayMs = LIVE_TRADING_ORDER_RETRY_DELAY_MS;
        const postStartedAtMs = now();
        try {
          const response = await client.createAndPostOrder(
            request.userOrder,
            request.options,
            OrderType.GTD,
            true,
          );
          const postDurationMs = Math.max(0, now() - postStartedAtMs);
          const postFailure = extractPostOrderFailure(response);
          if (postFailure === null) {
            logOrder({
              order,
              status: "placed",
              attempt,
              placement: cappedPlacement,
              session,
              orderId: extractOrderId(response),
              postDurationMs,
              message: previewResponse(response),
            });
            return;
          }
          const retryAction = classifyPostOrderFailure(postFailure);
          retryDelayMs = retryDelayForPostFailure({
            failure: postFailure,
            attempt,
          });
          if (retryAction === "post_only_cross") {
            postOnlyLimitCap = nextPostOnlyLimitCap({
              market: session.market,
              limitPrice: cappedPlacement.limitPrice,
            });
          }
          if (
            retryAction === "terminal" ||
            !shouldRetryOrderPlacement({
              attempt,
              retryUntilMs,
              nowMs: now(),
            })
          ) {
            logOrder({
              order,
              status: "rejected",
              attempt,
              placement: cappedPlacement,
              session,
              failure: postFailure,
              postDurationMs,
              message: postFailure.message,
            });
            return;
          }
        } catch (error) {
          const postDurationMs = Math.max(0, now() - postStartedAtMs);
          const postFailure = postOrderFailureFromError(error);
          const retryAction = classifyPostOrderFailure(postFailure);
          retryDelayMs = retryDelayForPostFailure({
            failure: postFailure,
            attempt,
          });
          if (retryAction === "post_only_cross") {
            postOnlyLimitCap = nextPostOnlyLimitCap({
              market: session.market,
              limitPrice: cappedPlacement.limitPrice,
            });
          }
          if (
            retryAction === "terminal" ||
            !shouldRetryOrderPlacement({
              attempt,
              retryUntilMs,
              nowMs: now(),
            })
          ) {
            logOrder({
              order,
              status: "rejected",
              attempt,
              placement: cappedPlacement,
              session,
              failure: postFailure,
              postDurationMs,
              message: postFailure.message,
            });
            return;
          }
        }
        await sleep(retryDelayMs);
      }
    } catch (error) {
      log({
        kind: "error",
        message: `unexpected live order placement error ${order.period}/${order.asset}: ${String(error)}`,
      });
    }
  };

  const pruneExpiredSessions = ({
    nowMs,
  }: {
    readonly nowMs: number;
  }): void => {
    let changed = false;
    for (const [key, session] of sessions.entries()) {
      if (nowMs <= session.expiresAtMs + LIVE_TRADING_SESSION_GRACE_MS) {
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
    session = null,
    failure = null,
    postDurationMs = null,
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
    readonly session?: OrderSession | null;
    readonly failure?: PostOrderFailure | null;
    readonly postDurationMs?: number | null;
    readonly orderId?: string | null;
    readonly message?: string | null;
  }): void {
    const tokenRef =
      session === null
        ? null
        : order.prediction === "u"
          ? session.market.upRef
          : session.market.downRef;
    const oppositeTokenRef =
      session === null
        ? null
        : order.prediction === "u"
          ? session.market.downRef
          : session.market.upRef;
    const book =
      session === null
        ? null
        : summarizePredictedSideBook({
            prediction: order.prediction,
            state: session.state,
            limitPrice: placement?.limitPrice ?? null,
            nowMs: now(),
            maxQuoteAgeMs: LIVE_TRADING_ORDER_MAX_QUOTE_AGE_MS,
            defaultTickSize: LIVE_TRADING_ORDER_DEFAULT_TICK_SIZE,
          });
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
      marketRef: session?.market.vendorRef ?? null,
      tokenRef,
      oppositeTokenRef,
      failureStatus: failure?.status ?? null,
      failureKind:
        failure === null ? null : classifyPostOrderFailureKind(failure),
      postDurationMs,
      predictedBestBid: book?.predictedBestBid ?? null,
      predictedBestAsk: book?.predictedBestAsk ?? null,
      predictedSpread: book?.predictedSpread ?? null,
      predictedBidAgeMs: book?.predictedBidAgeMs ?? null,
      predictedAskAgeMs: book?.predictedAskAgeMs ?? null,
      predictedBookAgeMs: book?.predictedBookAgeMs ?? null,
      predictedBidLevels: book?.predictedBidLevels ?? null,
      predictedAskLevels: book?.predictedAskLevels ?? null,
      predictedBidDepthAtLimitUsd: book?.predictedBidDepthAtLimitUsd ?? null,
      predictedBidDepthAboveLimitUsd:
        book?.predictedBidDepthAboveLimitUsd ?? null,
      predictedBidDepthAtOrAboveLimitUsd:
        book?.predictedBidDepthAtOrAboveLimitUsd ?? null,
      predictedAskDepthAtBestUsd: book?.predictedAskDepthAtBestUsd ?? null,
      predictedAskDepthWithin1cUsd: book?.predictedAskDepthWithin1cUsd ?? null,
      predictedAskDepthWithin2cUsd: book?.predictedAskDepthWithin2cUsd ?? null,
      oppositeBestBid: book?.oppositeBestBid ?? null,
      oppositeBestAsk: book?.oppositeBestAsk ?? null,
      oppositeSpread: book?.oppositeSpread ?? null,
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
  readonly options: { readonly tickSize: TickSize; readonly negRisk: boolean };
} {
  if (!Number.isFinite(limitPrice) || limitPrice <= 0 || limitPrice >= 1) {
    throw new Error(`invalid live order limit price: ${limitPrice}`);
  }
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
      negRisk: market.negRisk ?? false,
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

type PostOrderFailure = {
  readonly status: number | null;
  readonly message: string;
};

type PostOrderRetryAction = "retry" | "terminal" | "post_only_cross";

function applyPostOnlyLimitCap({
  placement,
  maxLimitPrice,
  tickSize,
  priceWindow,
}: {
  readonly placement: MakerLimitBuyPlacement;
  readonly maxLimitPrice: number | null;
  readonly tickSize: number;
  readonly priceWindow: number;
}): MakerLimitBuyPlacement {
  if (maxLimitPrice === null || placement.status !== "placeable") {
    return placement;
  }
  const limitPrice = roundDownToTick(
    Math.min(placement.limitPrice, maxLimitPrice),
    tickSize,
  );
  if (!Number.isFinite(limitPrice)) {
    return { status: "no_price" };
  }
  if (limitPrice < tickSize || limitPrice > 1 - tickSize) {
    return { status: "no_price" };
  }
  if (Math.abs(limitPrice - 0.5) > priceWindow) {
    return {
      status: "price_window",
      observedPrice: placement.observedPrice,
      limitPrice,
      confidence: placement.confidence,
    };
  }
  return { ...placement, limitPrice };
}

function nextPostOnlyLimitCap({
  market,
  limitPrice,
}: {
  readonly market: TradableMarket;
  readonly limitPrice: number;
}): number | null {
  const tickSize = resolveTickSize({
    tickSize: market.tickSize ?? null,
    defaultTickSize: LIVE_TRADING_ORDER_DEFAULT_TICK_SIZE,
  });
  const next = roundDownToTick(limitPrice - tickSize, tickSize);
  return Number.isFinite(next) && next > 0 && next < 1 ? next : null;
}

function shouldRetryOrderPlacement({
  attempt,
  retryUntilMs,
  nowMs,
}: {
  readonly attempt: number;
  readonly retryUntilMs: number;
  readonly nowMs: number;
}): boolean {
  return attempt < LIVE_TRADING_MAX_ORDER_ATTEMPTS && nowMs <= retryUntilMs;
}

function orderRetryUntilMs({
  order,
  nowMs,
}: {
  readonly order: ScheduledLiveOrder;
  readonly nowMs: number;
}): number {
  return Math.min(
    order.expiresAtMs,
    Math.max(
      order.targetTsMs + LIVE_TRADING_ORDER_RETRY_AFTER_OPEN_MS,
      nowMs + LIVE_TRADING_ORDER_MIN_RETRY_WINDOW_MS,
    ),
  );
}

function extractPostOrderFailure(response: unknown): PostOrderFailure | null {
  if (response === null || typeof response !== "object") {
    return null;
  }
  const record = response as Record<string, unknown>;
  if (record["success"] === false) {
    return {
      status: extractResponseStatus(response),
      message:
        extractResponseMessage(response) ?? "order post returned success=false",
    };
  }
  if (record["error"] !== undefined && record["error"] !== null) {
    return {
      status: extractResponseStatus(response),
      message:
        extractResponseMessage(response) ?? unknownToMessage(record["error"]),
    };
  }
  return null;
}

function postOrderFailureFromError(error: unknown): PostOrderFailure {
  if (error instanceof Error) {
    const record = error as Error & { readonly status?: unknown };
    return {
      status: typeof record.status === "number" ? record.status : null,
      message: error.message,
    };
  }
  return { status: null, message: String(error) };
}

function classifyPostOrderFailure({
  status,
  message,
}: PostOrderFailure): PostOrderRetryAction {
  const kind = classifyPostOrderFailureKind({ status, message });
  if (kind === "post_only_cross") {
    return "post_only_cross";
  }
  if (
    kind === "auth" ||
    kind === "balance_or_allowance" ||
    kind === "invalid_order" ||
    kind === "closed_or_banned" ||
    kind === "terminal"
  ) {
    return "terminal";
  }
  return "retry";
}

function classifyPostOrderFailureKind({
  status,
  message,
}: PostOrderFailure): LiveTradingOrderFailureKind {
  const lower = message.toLowerCase();
  if (
    (lower.includes("post-only") && lower.includes("cross")) ||
    lower.includes("crosses book") ||
    lower.includes("crosses the book")
  ) {
    return "post_only_cross";
  }
  if (lower.includes("not enough balance") || lower.includes("allowance")) {
    return "balance_or_allowance";
  }
  if (
    lower.includes("owner has to be") ||
    lower.includes("signer address") ||
    lower.includes("invalid signature") ||
    status === 401
  ) {
    return "auth";
  }
  if (lower.includes("banned") || lower.includes("closed only")) {
    return "closed_or_banned";
  }
  if (
    lower.includes("invalid payload") ||
    lower.includes("invalid expiration") ||
    lower.includes("breaks minimum tick size") ||
    lower.includes("lower than the minimum")
  ) {
    return "invalid_order";
  }
  if (
    lower.includes("not yet ready") ||
    lower.includes("service not ready") ||
    lower.includes("cancel-only") ||
    lower.includes("new orders are not accepted") ||
    lower.includes("too early") ||
    status === 425
  ) {
    return "not_ready";
  }
  if (
    lower.includes("rate limit") ||
    lower.includes("too many requests") ||
    status === 429
  ) {
    return "rate_limited";
  }
  if (lower.includes("not found") || status === 404) {
    return "not_found";
  }
  if (
    lower.includes("matching engine") ||
    lower.includes("temporarily") ||
    lower.includes("service unavailable") ||
    lower.includes("internal server") ||
    (status !== null && status >= 500 && status < 600)
  ) {
    return "server_error";
  }
  if (lower.includes("context canceled") || status === null) {
    return "network_or_unknown";
  }
  return status === 400 ? "terminal" : "unknown";
}

function retryDelayForPostFailure({
  failure,
  attempt,
}: {
  readonly failure: PostOrderFailure;
  readonly attempt: number;
}): number {
  const kind = classifyPostOrderFailureKind(failure);
  if (kind === "rate_limited") {
    return Math.min(
      LIVE_TRADING_ORDER_MAX_RETRY_DELAY_MS,
      LIVE_TRADING_ORDER_RATE_LIMIT_RETRY_BASE_MS * attempt,
    );
  }
  if (kind === "server_error" || kind === "network_or_unknown") {
    return Math.min(
      LIVE_TRADING_ORDER_MAX_RETRY_DELAY_MS,
      LIVE_TRADING_ORDER_TRANSIENT_RETRY_BASE_MS * attempt,
    );
  }
  return LIVE_TRADING_ORDER_RETRY_DELAY_MS;
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

function extractResponseStatus(response: object): number | null {
  const record = response as Record<string, unknown>;
  const value = record["status"];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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
