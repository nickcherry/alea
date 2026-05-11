import type { LeadingSide } from "@alea/lib/trading/types";
import type { Asset } from "@alea/types/assets";

/**
 * Vendor-shared shapes for the Polymarket market-data WebSocket
 * stream (consumed by `marketCapture` to record book/trade
 * snapshots). The richer Vendor abstraction that used to live here —
 * order placement, cancels, user-fill streams, market hydration —
 * was tied to the deleted regime/live-trading framework and is gone.
 *
 * When live trading comes back on the new filter-committee framework
 * it will land here as a fresh, narrower interface; the abandoned
 * Vendor draft isn't worth resurrecting.
 */

/**
 * One "up/down 5m" market the capture pipeline tracks. `vendorRef`,
 * `upRef`, and `downRef` are opaque strings that can embed venue-
 * native ids (Polymarket conditionId + clob tokenIds) without the
 * downstream pipeline caring about their shape. `asset` is the only
 * domain-typed field — every other piece of metadata stays in the
 * vendor adapter.
 */
export type TradableMarket = {
  readonly asset: Asset;
  readonly vendorRef: string;
  readonly upRef: string;
  readonly downRef: string;
};

export type PriceLevel = {
  readonly price: number;
  readonly size: number;
};

export type MarketDataStreamHandle = {
  readonly stop: () => Promise<void>;
};

export type MarketDataTradeEvent = {
  readonly kind: "trade";
  readonly vendorRef: string | null;
  readonly outcomeRef: string;
  readonly price: number;
  readonly size: number | null;
  readonly side: "BUY" | "SELL" | null;
  readonly atMs: number;
};

export type MarketDataBookEvent = {
  readonly kind: "book";
  readonly vendorRef: string | null;
  readonly outcomeRef: string;
  readonly bids: readonly PriceLevel[];
  readonly asks: readonly PriceLevel[];
  readonly atMs: number;
};

export type MarketDataBestBidAskEvent = {
  readonly kind: "best-bid-ask";
  readonly vendorRef: string | null;
  readonly outcomeRef: string;
  readonly bestBid: number | null;
  readonly bestAsk: number | null;
  readonly atMs: number;
};

export type MarketDataPriceChangeEvent = {
  readonly kind: "price-change";
  readonly vendorRef: string | null;
  readonly outcomeRef: string;
  readonly price: number;
  readonly side: "BUY" | "SELL" | null;
  readonly size: number | null;
  readonly atMs: number;
};

export type MarketDataTickSizeChangeEvent = {
  readonly kind: "tick-size-change";
  readonly vendorRef: string | null;
  readonly outcomeRef: string | null;
  readonly oldTickSize: number | null;
  readonly newTickSize: number;
  readonly atMs: number;
};

export type MarketDataResolvedEvent = {
  readonly kind: "resolved";
  readonly vendorRef: string;
  readonly winningOutcomeRef: string | null;
  readonly winningSide: LeadingSide | null;
  readonly atMs: number;
};

export type MarketDataEvent =
  | MarketDataTradeEvent
  | MarketDataBookEvent
  | MarketDataBestBidAskEvent
  | MarketDataPriceChangeEvent
  | MarketDataTickSizeChangeEvent
  | MarketDataResolvedEvent;

export type MarketDataStreamCallbacks = {
  readonly onEvent: (event: MarketDataEvent) => void;
  readonly onConnect?: () => void;
  readonly onDisconnect?: (reason: string) => void;
  readonly onError?: (error: Error) => void;
};
