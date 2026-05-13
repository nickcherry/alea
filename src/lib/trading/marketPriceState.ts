import type {
  MarketDataEvent,
  PriceLevel,
} from "@alea/lib/trading/vendor/types";

type TokenPriceState = {
  bid: number | null;
  bidAtMs: number | null;
  ask: number | null;
  askAtMs: number | null;
  bids: readonly PriceLevel[];
  bidsAtMs: number | null;
  asks: readonly PriceLevel[];
  asksAtMs: number | null;
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

export type PredictedSideBookSnapshot = {
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
};

export function emptyMarketPriceState({
  tickSize = null,
}: {
  readonly tickSize?: number | null;
} = {}): MarketPriceState {
  return {
    up: {
      bid: null,
      bidAtMs: null,
      ask: null,
      askAtMs: null,
      bids: [],
      bidsAtMs: null,
      asks: [],
      asksAtMs: null,
      tickSize,
    },
    down: {
      bid: null,
      bidAtMs: null,
      ask: null,
      askAtMs: null,
      bids: [],
      bidsAtMs: null,
      asks: [],
      asksAtMs: null,
      tickSize,
    },
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
      token.bids = event.bids;
      token.bidsAtMs = event.atMs;
      token.ask = bestAsk(event.asks);
      token.askAtMs = event.atMs;
      token.asks = event.asks;
      token.asksAtMs = event.atMs;
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
  fallbackLimitPrice = null,
}: {
  readonly prediction: "u" | "d";
  readonly state: MarketPriceState;
  readonly nowMs: number;
  readonly confidence: number | null;
  readonly priceWindow: number;
  readonly maxQuoteAgeMs: number;
  readonly defaultTickSize: number;
  readonly fallbackLimitPrice?: number | null;
}): MakerLimitBuyPlacement {
  const limitPrice =
    predictedSideAggressiveMakerBuyPrice({
      prediction,
      state,
      nowMs,
      maxQuoteAgeMs,
      defaultTickSize,
    }) ?? normalizeFallbackLimitPrice({ fallbackLimitPrice });
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

export function summarizePredictedSideBook({
  prediction,
  state,
  limitPrice,
  nowMs,
  maxQuoteAgeMs,
  defaultTickSize,
}: {
  readonly prediction: "u" | "d";
  readonly state: MarketPriceState;
  readonly limitPrice: number | null;
  readonly nowMs: number;
  readonly maxQuoteAgeMs: number;
  readonly defaultTickSize: number;
}): PredictedSideBookSnapshot {
  const predicted = prediction === "u" ? state.up : state.down;
  const opposite = prediction === "u" ? state.down : state.up;
  const predictedBestBid = freshTokenPrice({
    price: predicted.bid,
    atMs: predicted.bidAtMs,
    nowMs,
    maxQuoteAgeMs,
  });
  const predictedBestAsk = freshTokenPrice({
    price: predicted.ask,
    atMs: predicted.askAtMs,
    nowMs,
    maxQuoteAgeMs,
  });
  const oppositeBestBid = freshTokenPrice({
    price: opposite.bid,
    atMs: opposite.bidAtMs,
    nowMs,
    maxQuoteAgeMs,
  });
  const oppositeBestAsk = freshTokenPrice({
    price: opposite.ask,
    atMs: opposite.askAtMs,
    nowMs,
    maxQuoteAgeMs,
  });
  const predictedBids = freshLevels({
    levels: predicted.bids,
    atMs: predicted.bidsAtMs,
    nowMs,
    maxQuoteAgeMs,
  });
  const predictedAsks = freshLevels({
    levels: predicted.asks,
    atMs: predicted.asksAtMs,
    nowMs,
    maxQuoteAgeMs,
  });
  const tickSize = resolveTickSize({
    tickSize: predicted.tickSize,
    defaultTickSize,
  });
  return {
    predictedBestBid,
    predictedBestAsk,
    predictedSpread: spread({ bid: predictedBestBid, ask: predictedBestAsk }),
    predictedBidAgeMs: ageMs({ atMs: predicted.bidAtMs, nowMs }),
    predictedAskAgeMs: ageMs({ atMs: predicted.askAtMs, nowMs }),
    predictedBookAgeMs: bookAgeMs({
      bidAtMs: predicted.bidAtMs,
      askAtMs: predicted.askAtMs,
      nowMs,
    }),
    predictedBidLevels:
      predictedBids === null ? null : countValidLevels(predictedBids),
    predictedAskLevels:
      predictedAsks === null ? null : countValidLevels(predictedAsks),
    predictedBidDepthAtLimitUsd:
      predictedBids === null || limitPrice === null
        ? null
        : sumDepthUsd({
            levels: predictedBids,
            matches: (price) => Math.abs(price - limitPrice) <= tickSize / 2,
          }),
    predictedBidDepthAboveLimitUsd:
      predictedBids === null || limitPrice === null
        ? null
        : sumDepthUsd({
            levels: predictedBids,
            matches: (price) => price > limitPrice,
          }),
    predictedBidDepthAtOrAboveLimitUsd:
      predictedBids === null || limitPrice === null
        ? null
        : sumDepthUsd({
            levels: predictedBids,
            matches: (price) => price >= limitPrice,
          }),
    predictedAskDepthAtBestUsd:
      predictedAsks === null || predictedBestAsk === null
        ? null
        : sumDepthUsd({
            levels: predictedAsks,
            matches: (price) =>
              Math.abs(price - predictedBestAsk) <= tickSize / 2,
          }),
    predictedAskDepthWithin1cUsd:
      predictedAsks === null || predictedBestAsk === null
        ? null
        : sumDepthUsd({
            levels: predictedAsks,
            matches: (price) =>
              price >= predictedBestAsk && price <= predictedBestAsk + 0.01,
          }),
    predictedAskDepthWithin2cUsd:
      predictedAsks === null || predictedBestAsk === null
        ? null
        : sumDepthUsd({
            levels: predictedAsks,
            matches: (price) =>
              price >= predictedBestAsk && price <= predictedBestAsk + 0.02,
          }),
    oppositeBestBid,
    oppositeBestAsk,
    oppositeSpread: spread({ bid: oppositeBestBid, ask: oppositeBestAsk }),
  };
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

export function predictedSideOneTickBelowReferencePrice({
  prediction,
  state,
  referencePrice,
  defaultTickSize,
}: {
  readonly prediction: "u" | "d";
  readonly state: MarketPriceState;
  readonly referencePrice: number;
  readonly defaultTickSize: number;
}): number | null {
  if (!isValidTokenPrice(referencePrice)) {
    return null;
  }
  const target = prediction === "u" ? state.up : state.down;
  const tickSize = resolveTickSize({
    tickSize: target.tickSize,
    defaultTickSize,
  });
  const limitPrice = roundDownToTick(referencePrice - tickSize, tickSize);
  if (limitPrice < tickSize || limitPrice > 1 - tickSize) {
    return null;
  }
  return limitPrice;
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
  if (!Number.isFinite(value)) {
    return Number.NaN;
  }
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

function normalizeFallbackLimitPrice({
  fallbackLimitPrice,
}: {
  readonly fallbackLimitPrice: number | null;
}): number | null {
  return isValidTokenPrice(fallbackLimitPrice) &&
    fallbackLimitPrice > 0 &&
    fallbackLimitPrice < 1
    ? roundPrice(fallbackLimitPrice)
    : null;
}

function isValidTickSize(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0 && value < 1;
}

export function roundDownToTick(value: number, tickSize: number): number {
  if (!Number.isFinite(value) || !isValidTickSize(tickSize)) {
    return Number.NaN;
  }
  const ticks = Math.floor((value + Number.EPSILON) / tickSize);
  return roundPrice(ticks * tickSize);
}

function freshTokenPrice({
  price,
  atMs,
  nowMs,
  maxQuoteAgeMs,
}: {
  readonly price: number | null;
  readonly atMs: number | null;
  readonly nowMs: number;
  readonly maxQuoteAgeMs: number;
}): number | null {
  if (!isFreshPrice({ atMs, nowMs, maxAgeMs: maxQuoteAgeMs })) {
    return null;
  }
  return normalizePrice(price);
}

function freshLevels({
  levels,
  atMs,
  nowMs,
  maxQuoteAgeMs,
}: {
  readonly levels: readonly PriceLevel[];
  readonly atMs: number | null;
  readonly nowMs: number;
  readonly maxQuoteAgeMs: number;
}): readonly PriceLevel[] | null {
  return isFreshPrice({ atMs, nowMs, maxAgeMs: maxQuoteAgeMs }) ? levels : null;
}

function ageMs({
  atMs,
  nowMs,
}: {
  readonly atMs: number | null;
  readonly nowMs: number;
}): number | null {
  return atMs === null || atMs > nowMs ? null : nowMs - atMs;
}

function bookAgeMs({
  bidAtMs,
  askAtMs,
  nowMs,
}: {
  readonly bidAtMs: number | null;
  readonly askAtMs: number | null;
  readonly nowMs: number;
}): number | null {
  const bidAge = ageMs({ atMs: bidAtMs, nowMs });
  const askAge = ageMs({ atMs: askAtMs, nowMs });
  if (bidAge === null) {
    return askAge;
  }
  if (askAge === null) {
    return bidAge;
  }
  return Math.max(bidAge, askAge);
}

function spread({
  bid,
  ask,
}: {
  readonly bid: number | null;
  readonly ask: number | null;
}): number | null {
  return bid === null || ask === null || ask < bid
    ? null
    : roundPrice(ask - bid);
}

function countValidLevels(levels: readonly PriceLevel[]): number {
  let count = 0;
  for (const level of levels) {
    if (normalizePrice(level.price) !== null && isValidSize(level.size)) {
      count += 1;
    }
  }
  return count;
}

function sumDepthUsd({
  levels,
  matches,
}: {
  readonly levels: readonly PriceLevel[];
  readonly matches: (price: number) => boolean;
}): number {
  let total = 0;
  for (const level of levels) {
    const price = normalizePrice(level.price);
    if (price === null || !isValidSize(level.size) || !matches(price)) {
      continue;
    }
    total += price * level.size;
  }
  return Number(total.toFixed(4));
}

function isValidSize(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
