import type {
  MarketDataEvent,
  PriceLevel,
} from "@alea/lib/trading/vendor/types";

type TokenPriceState = {
  bid: number | null;
  bidAtMs: number | null;
  ask: number | null;
  askAtMs: number | null;
  tickSize: number | null;
};

export type MarketPriceState = {
  up: TokenPriceState;
  down: TokenPriceState;
};

export type MarketDataTokenRoute = {
  readonly state: MarketPriceState;
  readonly side: "up" | "down";
};

export type MakerLimitBuyPlacement =
  | {
      readonly status: "no_price";
    }
  | {
      readonly status: "price_window";
      readonly observedPrice: number;
      readonly limitPrice: number;
      readonly confidence: number | null;
    }
  | {
      readonly status: "confidence";
      readonly observedPrice: number;
      readonly limitPrice: number;
      readonly confidence: number | null;
    }
  | {
      readonly status: "placeable";
      readonly observedPrice: number;
      readonly limitPrice: number;
      readonly confidence: number;
    };

export function emptyMarketPriceState({
  tickSize = null,
}: {
  readonly tickSize?: number | null;
} = {}): MarketPriceState {
  return {
    up: { bid: null, bidAtMs: null, ask: null, askAtMs: null, tickSize },
    down: { bid: null, bidAtMs: null, ask: null, askAtMs: null, tickSize },
  };
}

export function applyMarketDataEventToMarketPriceState({
  event,
  tokenRoutes,
}: {
  readonly event: MarketDataEvent;
  readonly tokenRoutes: ReadonlyMap<string, MarketDataTokenRoute>;
}): void {
  if (event.kind === "resolved") {
    return;
  }
  if (event.outcomeRef === null) {
    return;
  }
  const route = tokenRoutes.get(event.outcomeRef);
  if (route === undefined) {
    return;
  }
  const token = route.side === "up" ? route.state.up : route.state.down;
  switch (event.kind) {
    case "book":
      token.bid = bestBid(event.bids);
      token.bidAtMs = event.atMs;
      token.ask = bestAsk(event.asks);
      token.askAtMs = event.atMs;
      break;
    case "best-bid-ask":
      token.bid = normalizePrice(event.bestBid);
      token.bidAtMs = event.atMs;
      token.ask = normalizePrice(event.bestAsk);
      token.askAtMs = event.atMs;
      break;
    case "price-change":
    case "trade":
      break;
    case "tick-size-change":
      if (isValidTickSize(event.newTickSize)) {
        token.tickSize = event.newTickSize;
      }
      break;
  }
}

export function resolveMakerLimitBuyPlacement({
  prediction,
  state,
  nowMs,
  confidence,
  priceWindow,
  maxQuoteAgeMs,
  defaultTickSize,
}: {
  readonly prediction: "u" | "d";
  readonly state: MarketPriceState;
  readonly nowMs: number;
  readonly confidence: number | null;
  readonly priceWindow: number;
  readonly maxQuoteAgeMs: number;
  readonly defaultTickSize: number;
}): MakerLimitBuyPlacement {
  const limitPrice = predictedSideAggressiveMakerBuyPrice({
    prediction,
    state,
    nowMs,
    maxQuoteAgeMs,
    defaultTickSize,
  });
  if (limitPrice === null) {
    return { status: "no_price" };
  }

  const observed =
    observedPredictedSidePrice({ prediction, state, nowMs, maxQuoteAgeMs }) ??
    limitPrice;
  if (Math.abs(limitPrice - 0.5) > priceWindow) {
    return {
      status: "price_window",
      observedPrice: observed,
      limitPrice,
      confidence,
    };
  }
  if (confidence === null || confidence < limitPrice) {
    return {
      status: "confidence",
      observedPrice: observed,
      limitPrice,
      confidence,
    };
  }

  return {
    status: "placeable",
    observedPrice: observed,
    limitPrice,
    confidence,
  };
}

export function observedPredictedSidePrice({
  prediction,
  state,
  nowMs,
  maxQuoteAgeMs,
}: {
  readonly prediction: "u" | "d";
  readonly state: MarketPriceState;
  readonly nowMs: number;
  readonly maxQuoteAgeMs: number;
}): number | null {
  const target = prediction === "u" ? state.up : state.down;
  const opposite = prediction === "u" ? state.down : state.up;
  return (
    midPrice({ state: target, nowMs, maxQuoteAgeMs }) ??
    invertPrice(midPrice({ state: opposite, nowMs, maxQuoteAgeMs }))
  );
}

export function predictedSideAggressiveMakerBuyPrice({
  prediction,
  state,
  nowMs,
  maxQuoteAgeMs,
  defaultTickSize,
}: {
  readonly prediction: "u" | "d";
  readonly state: MarketPriceState;
  readonly nowMs: number;
  readonly maxQuoteAgeMs: number;
  readonly defaultTickSize: number;
}): number | null {
  const target = prediction === "u" ? state.up : state.down;
  if (!isFreshPrice({ atMs: target.askAtMs, nowMs, maxAgeMs: maxQuoteAgeMs })) {
    return null;
  }
  if (!isValidTokenPrice(target.ask)) {
    return null;
  }
  const tickSize = resolveTickSize({
    tickSize: target.tickSize,
    defaultTickSize,
  });
  const limitPrice = roundDownToTick(target.ask - tickSize, tickSize);
  if (limitPrice < tickSize || limitPrice > 1 - tickSize) {
    return null;
  }
  return limitPrice;
}

export function resolveTickSize({
  tickSize,
  defaultTickSize,
}: {
  readonly tickSize: number | null;
  readonly defaultTickSize: number;
}): number {
  return isValidTickSize(tickSize) ? tickSize : defaultTickSize;
}

export function isFreshPrice({
  atMs,
  nowMs,
  maxAgeMs,
}: {
  readonly atMs: number | null;
  readonly nowMs: number;
  readonly maxAgeMs: number;
}): boolean {
  return atMs !== null && atMs <= nowMs && nowMs - atMs <= maxAgeMs;
}

export function isValidTokenPrice(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function roundPrice(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}

function bestBid(levels: readonly PriceLevel[]): number | null {
  let best: number | null = null;
  for (const level of levels) {
    const price = normalizePrice(level.price);
    if (price === null) {
      continue;
    }
    if (best === null || price > best) {
      best = price;
    }
  }
  return best;
}

function bestAsk(levels: readonly PriceLevel[]): number | null {
  let best: number | null = null;
  for (const level of levels) {
    const price = normalizePrice(level.price);
    if (price === null) {
      continue;
    }
    if (best === null || price < best) {
      best = price;
    }
  }
  return best;
}

function midPrice({
  state,
  nowMs,
  maxQuoteAgeMs,
}: {
  readonly state: TokenPriceState;
  readonly nowMs: number;
  readonly maxQuoteAgeMs: number;
}): number | null {
  if (
    state.bid === null ||
    state.ask === null ||
    state.ask < state.bid ||
    !isFreshPrice({ atMs: state.bidAtMs, nowMs, maxAgeMs: maxQuoteAgeMs }) ||
    !isFreshPrice({ atMs: state.askAtMs, nowMs, maxAgeMs: maxQuoteAgeMs })
  ) {
    return null;
  }
  return roundPrice((state.bid + state.ask) / 2);
}

function invertPrice(value: number | null): number | null {
  return value === null ? null : roundPrice(1 - value);
}

function normalizePrice(value: number | null): number | null {
  return isValidTokenPrice(value) ? value : null;
}

function isValidTickSize(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0 && value < 1;
}

function roundDownToTick(value: number, tickSize: number): number {
  const ticks = Math.floor((value + Number.EPSILON) / tickSize);
  return roundPrice(ticks * tickSize);
}
