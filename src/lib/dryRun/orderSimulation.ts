import {
  DRY_RUN_ORDER_DEFAULT_TICK_SIZE,
  DRY_RUN_ORDER_MAX_QUOTE_AGE_MS,
  DRY_RUN_ORDER_NO_QUOTE_LIMIT_PRICE,
  DRY_RUN_ORDER_PLACEMENT_DELAY_MS,
  DRY_RUN_ORDER_PRICE_WINDOW,
  type DryRunOrderStatus,
} from "@alea/constants/dryRun";
import type { TradeDecisionPeriod } from "@alea/constants/tradeDecision";
import type { DatabaseClient } from "@alea/lib/db/types";
import type { FilterPrediction } from "@alea/lib/filters/types";
import { resolutionTimeframeStepMs } from "@alea/lib/polymarket/enumerateWindowStarts";
import {
  applyMarketDataEventToMarketPriceState,
  emptyMarketPriceState,
  isFreshPrice,
  isValidTokenPrice,
  type MarketDataTokenRoute,
  type MarketPriceState,
  observedPredictedSidePrice,
  resolveMakerLimitBuyPlacement,
  roundPrice,
} from "@alea/lib/trading/marketPriceState";
import type { PolymarketMarketDiscoveryCache } from "@alea/lib/trading/vendor/polymarket/marketDiscoveryCache";
import { streamPolymarketMarketData } from "@alea/lib/trading/vendor/polymarket/streamMarketData";
import type {
  MarketDataStreamHandle,
  TradableMarket,
} from "@alea/lib/trading/vendor/types";
import type { Asset } from "@alea/types/assets";

export type DryRunMarketPriceState = MarketPriceState;

export type DryRunOrderPlacementResolution =
  | {
      readonly status: "skipped_no_price";
    }
  | {
      readonly status: "skipped_price_window" | "skipped_confidence";
      readonly observedPrice: number;
      readonly limitPrice: number;
      readonly confidence: number | null;
    }
  | {
      readonly status: "placed" | "filled";
      readonly observedPrice: number;
      readonly limitPrice: number;
      readonly confidence: number;
      readonly fillPrice: number | null;
    };

export type DryRunOrderLogEvent = {
  readonly kind: "order";
  readonly asset: Asset;
  readonly period: TradeDecisionPeriod;
  readonly tsMs: number;
  readonly prediction: "u" | "d";
  readonly status: DryRunOrderStatus;
  readonly observedPrice: number | null;
  readonly limitPrice: number | null;
  readonly confidence: number | null;
  readonly fillPrice: number | null;
};

type PendingDryRunOrder = {
  readonly decisionId: string;
  readonly asset: Asset;
  readonly period: TradeDecisionPeriod;
  readonly prediction: "u" | "d";
  readonly targetTsMs: number;
  readonly orderAtMs: number;
  readonly expiresAtMs: number;
  readonly confidence: number | null;
  marketKey: string | null;
  status: DryRunOrderStatus;
  observedPrice: number | null;
  limitPrice: number | null;
};

type OrderSession = {
  readonly key: string;
  readonly market: TradableMarket;
  readonly state: DryRunMarketPriceState;
  readonly orderIds: Set<string>;
};

const terminalOrderStatuses: ReadonlySet<DryRunOrderStatus> = new Set([
  "skipped_no_market",
  "skipped_no_price",
  "skipped_price_window",
  "skipped_confidence",
  "filled",
  "unfilled",
  "untracked",
]);

export function resolveDryRunOrderPlacement({
  prediction,
  state,
  nowMs,
  confidence,
}: {
  readonly prediction: "u" | "d";
  readonly state: DryRunMarketPriceState;
  readonly nowMs: number;
  readonly confidence: number | null;
}): DryRunOrderPlacementResolution {
  const placement = resolveMakerLimitBuyPlacement({
    prediction,
    state,
    nowMs,
    confidence,
    priceWindow: DRY_RUN_ORDER_PRICE_WINDOW,
    maxQuoteAgeMs: DRY_RUN_ORDER_MAX_QUOTE_AGE_MS,
    defaultTickSize: DRY_RUN_ORDER_DEFAULT_TICK_SIZE,
  });
  if (placement.status === "no_price") {
    return resolveNoQuotePlacement({
      prediction,
      state,
      nowMs,
      confidence,
    });
  }
  if (placement.status === "price_window") {
    return {
      status: "skipped_price_window",
      observedPrice: placement.observedPrice,
      limitPrice: placement.limitPrice,
      confidence: placement.confidence,
    };
  }
  if (placement.status === "confidence") {
    return {
      status: "skipped_confidence",
      observedPrice: placement.observedPrice,
      limitPrice: placement.limitPrice,
      confidence: placement.confidence,
    };
  }

  const fillPrice = resolveDryRunOrderFill({
    prediction,
    state,
    limitPrice: placement.limitPrice,
    nowMs,
  });
  return {
    status: fillPrice === null ? "placed" : "filled",
    observedPrice: placement.observedPrice,
    limitPrice: placement.limitPrice,
    confidence: placement.confidence,
    fillPrice,
  };
}

function resolveNoQuotePlacement({
  prediction,
  state,
  nowMs,
  confidence,
}: {
  readonly prediction: "u" | "d";
  readonly state: DryRunMarketPriceState;
  readonly nowMs: number;
  readonly confidence: number | null;
}): DryRunOrderPlacementResolution {
  const limitPrice = DRY_RUN_ORDER_NO_QUOTE_LIMIT_PRICE;
  const observedPrice =
    observedPredictedSidePrice({
      prediction,
      state,
      nowMs,
      maxQuoteAgeMs: DRY_RUN_ORDER_MAX_QUOTE_AGE_MS,
    }) ?? limitPrice;
  if (confidence === null || confidence < limitPrice) {
    return {
      status: "skipped_confidence",
      observedPrice,
      limitPrice,
      confidence,
    };
  }
  return {
    status: "placed",
    observedPrice,
    limitPrice,
    confidence,
    fillPrice: null,
  };
}

export function resolveDryRunOrderFill({
  prediction,
  state,
  limitPrice,
  nowMs,
}: {
  readonly prediction: "u" | "d";
  readonly state: DryRunMarketPriceState;
  readonly limitPrice: number;
  readonly nowMs: number;
}): number | null {
  const token = prediction === "u" ? state.up : state.down;
  if (
    !isFreshPrice({
      atMs: token.askAtMs,
      nowMs,
      maxAgeMs: DRY_RUN_ORDER_MAX_QUOTE_AGE_MS,
    })
  ) {
    return null;
  }
  return isValidTokenPrice(token.ask) && token.ask <= limitPrice
    ? roundPrice(token.ask)
    : null;
}

export function averageWinningVoteConfidence({
  prediction,
  winRates,
}: {
  readonly prediction: FilterPrediction;
  readonly winRates: readonly (number | null)[];
}): number | null {
  if (prediction === null) {
    return null;
  }
  const usable = winRates.filter(
    (value): value is number =>
      value !== null && Number.isFinite(value) && value >= 0 && value <= 1,
  );
  if (usable.length === 0) {
    return null;
  }
  return usable.reduce((sum, value) => sum + value, 0) / usable.length;
}

export function createDryRunOrderSimulator({
  db,
  marketDiscovery,
  log,
}: {
  readonly db: DatabaseClient;
  readonly marketDiscovery: PolymarketMarketDiscoveryCache;
  readonly log: (event: DryRunOrderLogEvent) => void;
}): {
  readonly scheduleOrder: (input: {
    readonly decisionId: string;
    readonly asset: Asset;
    readonly period: TradeDecisionPeriod;
    readonly prediction: "u" | "d";
    readonly targetTsMs: number;
    readonly confidence: number | null;
  }) => Promise<void>;
  readonly tick: (input: { readonly nowMs: number }) => Promise<void>;
  readonly stop: () => Promise<void>;
} {
  const orders = new Map<string, PendingDryRunOrder>();
  const sessions = new Map<string, OrderSession>();
  const tokenRoutes = new Map<string, MarketDataTokenRoute>();
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

    streamHandle = streamPolymarketMarketData({
      markets,
      onEvent: (event) => {
        applyMarketDataEventToMarketPriceState({ event, tokenRoutes });
        void fillPlacedOrders({ eventAtMs: event.atMs });
      },
    });
  };

  const ensureSession = ({
    market,
    key,
  }: {
    readonly market: TradableMarket;
    readonly key: string;
  }): OrderSession => {
    const existing = sessions.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const created: OrderSession = {
      key,
      market,
      state: emptyMarketPriceState({ tickSize: market.tickSize ?? null }),
      orderIds: new Set<string>(),
    };
    sessions.set(key, created);
    rebuildSubscription();
    return created;
  };

  const attachCachedMarket = ({
    order,
  }: {
    readonly order: PendingDryRunOrder;
  }): boolean => {
    if (order.marketKey !== null && sessions.has(order.marketKey)) {
      return true;
    }
    const key = marketKey({
      asset: order.asset,
      period: order.period,
      targetTsMs: order.targetTsMs,
    });
    const cachedMarket = marketDiscovery.get({
      asset: order.asset,
      timeframe: order.period,
      windowStartTsMs: order.targetTsMs,
    });
    if (cachedMarket === null) {
      return false;
    }
    order.marketKey = key;
    ensureSession({ market: cachedMarket, key }).orderIds.add(order.decisionId);
    return true;
  };

  const scheduleOrder = async ({
    decisionId,
    asset,
    period,
    prediction,
    targetTsMs,
    confidence,
  }: {
    readonly decisionId: string;
    readonly asset: Asset;
    readonly period: TradeDecisionPeriod;
    readonly prediction: "u" | "d";
    readonly targetTsMs: number;
    readonly confidence: number | null;
  }): Promise<void> => {
    if (stopped) {
      return;
    }
    const stepMs = resolutionTimeframeStepMs({
      timeframe: period,
    });
    const order: PendingDryRunOrder = {
      decisionId,
      asset,
      period,
      prediction,
      targetTsMs,
      orderAtMs: targetTsMs + DRY_RUN_ORDER_PLACEMENT_DELAY_MS,
      expiresAtMs: targetTsMs + stepMs,
      confidence,
      marketKey: null,
      status: "pending_placement",
      observedPrice: null,
      limitPrice: null,
    };
    orders.set(decisionId, order);
    await db
      .updateTable("dry_run_decisions")
      .set({
        order_status: "pending_placement",
        order_confidence: confidence,
        order_expires_at_ms: order.expiresAtMs,
      })
      .where("id", "=", decisionId)
      .execute();

    if (attachCachedMarket({ order })) {
      return;
    }

    const key = marketKey({ asset, period, targetTsMs });
    void marketDiscovery
      .getOrDiscover({
        asset,
        timeframe: period,
        windowStartTsMs: targetTsMs,
      })
      .then((market) => {
        if (
          stopped ||
          market === null ||
          terminalOrderStatuses.has(order.status)
        ) {
          return;
        }
        order.marketKey = key;
        ensureSession({ market, key }).orderIds.add(decisionId);
      })
      .catch(() => {
        if (
          stopped ||
          Date.now() < order.orderAtMs ||
          terminalOrderStatuses.has(order.status)
        ) {
          return;
        }
        void markTerminal({
          order,
          status: "skipped_no_market",
          observedPrice: null,
          limitPrice: null,
          fillPrice: null,
        });
      });
  };

  const tick = async ({ nowMs }: { readonly nowMs: number }): Promise<void> => {
    if (stopped) {
      return;
    }
    for (const order of orders.values()) {
      if (terminalOrderStatuses.has(order.status)) {
        continue;
      }
      if (order.status === "pending_placement") {
        attachCachedMarket({ order });
        if (nowMs >= order.orderAtMs) {
          await placeOrder({ order });
          continue;
        }
      }
      if (order.status === "placed") {
        await maybeFillPlacedOrder({ order, eventAtMs: nowMs });
        if (order.status === "placed" && nowMs >= order.expiresAtMs) {
          await markTerminal({
            order,
            status: "unfilled",
            observedPrice: order.observedPrice,
            limitPrice: order.limitPrice,
            fillPrice: null,
          });
        }
      }
    }
    pruneFinishedSessions();
  };

  const placeOrder = async ({
    order,
  }: {
    readonly order: PendingDryRunOrder;
  }): Promise<void> => {
    attachCachedMarket({ order });
    const session =
      order.marketKey === null ? undefined : sessions.get(order.marketKey);
    if (session === undefined) {
      await markTerminal({
        order,
        status: "skipped_no_market",
        observedPrice: null,
        limitPrice: null,
        fillPrice: null,
      });
      return;
    }

    const placement = resolveDryRunOrderPlacement({
      prediction: order.prediction,
      state: session.state,
      nowMs: order.orderAtMs,
      confidence: order.confidence,
    });
    if (placement.status === "skipped_no_price") {
      await markTerminal({
        order,
        status: placement.status,
        observedPrice: null,
        limitPrice: null,
        fillPrice: null,
      });
      return;
    }
    order.observedPrice = placement.observedPrice;
    order.limitPrice = placement.limitPrice;
    if (
      placement.status === "skipped_price_window" ||
      placement.status === "skipped_confidence"
    ) {
      await markTerminal({
        order,
        status: placement.status,
        observedPrice: placement.observedPrice,
        limitPrice: placement.limitPrice,
        fillPrice: null,
      });
      return;
    }
    if (placement.status !== "placed" && placement.status !== "filled") {
      return;
    }

    order.status = placement.status;
    await db
      .updateTable("dry_run_decisions")
      .set({
        order_status: placement.status,
        order_placed_at_ms: order.orderAtMs,
        order_observed_price: placement.observedPrice,
        order_limit_price: placement.limitPrice,
        order_confidence: placement.confidence,
        order_filled_at_ms:
          placement.status === "filled" ? order.orderAtMs : null,
        order_fill_price: placement.fillPrice,
        order_fill_latency_ms: placement.status === "filled" ? 0 : null,
      })
      .where("id", "=", order.decisionId)
      .execute();
    logOrder({
      order,
      observedPrice: placement.observedPrice,
      limitPrice: placement.limitPrice,
      fillPrice: placement.fillPrice,
    });
  };

  const fillPlacedOrders = async ({
    eventAtMs,
  }: {
    readonly eventAtMs: number;
  }): Promise<void> => {
    for (const order of orders.values()) {
      if (order.status !== "placed") {
        continue;
      }
      await maybeFillPlacedOrder({ order, eventAtMs });
    }
  };

  const maybeFillPlacedOrder = async ({
    order,
    eventAtMs,
  }: {
    readonly order: PendingDryRunOrder;
    readonly eventAtMs: number;
  }): Promise<void> => {
    if (
      order.limitPrice === null ||
      order.marketKey === null ||
      eventAtMs < order.orderAtMs
    ) {
      return;
    }
    const session = sessions.get(order.marketKey);
    if (session === undefined) {
      return;
    }
    const fillPrice = resolveDryRunOrderFill({
      prediction: order.prediction,
      state: session.state,
      limitPrice: order.limitPrice,
      nowMs: eventAtMs,
    });
    if (fillPrice === null) {
      return;
    }
    order.status = "filled";
    const filledAtMs = Math.max(eventAtMs, order.orderAtMs);
    await db
      .updateTable("dry_run_decisions")
      .set({
        order_status: "filled",
        order_filled_at_ms: filledAtMs,
        order_fill_price: fillPrice,
        order_fill_latency_ms: filledAtMs - order.orderAtMs,
      })
      .where("id", "=", order.decisionId)
      .execute();
    logOrder({
      order,
      observedPrice: null,
      limitPrice: order.limitPrice,
      fillPrice,
    });
  };

  const markTerminal = async ({
    order,
    status,
    observedPrice,
    limitPrice,
    fillPrice,
  }: {
    readonly order: PendingDryRunOrder;
    readonly status: DryRunOrderStatus;
    readonly observedPrice: number | null;
    readonly limitPrice: number | null;
    readonly fillPrice: number | null;
  }): Promise<void> => {
    order.status = status;
    const update: {
      order_status: DryRunOrderStatus;
      order_observed_price: number | null;
      order_limit_price: number | null;
      order_fill_price: number | null;
    } = {
      order_status: status,
      order_observed_price: observedPrice,
      order_limit_price: limitPrice,
      order_fill_price: fillPrice,
    };
    await db
      .updateTable("dry_run_decisions")
      .set(update)
      .where("id", "=", order.decisionId)
      .execute();
    logOrder({ order, observedPrice, limitPrice, fillPrice });
  };

  const logOrder = ({
    order,
    observedPrice,
    limitPrice,
    fillPrice,
  }: {
    readonly order: PendingDryRunOrder;
    readonly observedPrice: number | null;
    readonly limitPrice: number | null;
    readonly fillPrice: number | null;
  }): void => {
    log({
      kind: "order",
      asset: order.asset,
      period: order.period,
      tsMs: order.targetTsMs,
      prediction: order.prediction,
      status: order.status,
      observedPrice,
      limitPrice,
      confidence: order.confidence,
      fillPrice,
    });
  };

  const pruneFinishedSessions = (): void => {
    let changed = false;
    for (const [key, session] of sessions) {
      for (const orderId of Array.from(session.orderIds)) {
        const order = orders.get(orderId);
        if (order === undefined || terminalOrderStatuses.has(order.status)) {
          session.orderIds.delete(orderId);
        }
      }
      if (session.orderIds.size === 0) {
        sessions.delete(key);
        changed = true;
      }
    }
    if (changed) {
      rebuildSubscription();
    }
  };

  return {
    scheduleOrder,
    tick,
    async stop(): Promise<void> {
      stopped = true;
      const handle = streamHandle;
      streamHandle = null;
      if (handle !== null) {
        await handle.stop();
      }
    },
  };
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
