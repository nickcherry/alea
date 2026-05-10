import type { TradeDecision } from "@alea/lib/trading/decision/types";
import type { SimulatedDryOrder } from "@alea/lib/trading/dryRun/fillSimulation";
import type { DryAggregateMetrics } from "@alea/lib/trading/dryRun/metrics";
import type {
  MarketDataBestBidAskEvent,
  MarketDataBookEvent,
  MarketDataResolvedEvent,
  MarketDataTradeEvent,
} from "@alea/lib/trading/vendor/types";
import type { Asset } from "@alea/types/assets";

/**
 * Strongly-typed projection of one `market_event` row, used as the
 * intermediate representation between the DB cursor and the per-window
 * replay driver. The `payload` JSONB has been parsed and re-shaped into
 * the same `MarketDataEvent` / `LivePriceTick`-flavoured structures the
 * production code consumes — so downstream code never touches raw
 * payload bytes.
 *
 * `tsMs` is the venue clock (or receive time when the venue didn't
 * provide one). `receivedMs` is our wall-clock receipt time. Both are
 * preserved so replay logic can (a) drive its virtual clock from
 * `tsMs` and (b) reason about inter-venue latency when comparing
 * sources during outcome resolution.
 */
export type ReplayEvent =
  | ReplayPolymarketBookEvent
  | ReplayPolymarketBestBidAskEvent
  | ReplayPolymarketTradeEvent
  | ReplayPolymarketResolvedEvent
  | ReplayBinancePerpBboEvent
  | ReplayCoinbaseSpotBboEvent
  | ReplayCoinbasePerpBboEvent
  | ReplayPythSpotBboEvent
  | ReplayChainlinkRefPriceEvent;

/**
 * Discriminator for which captured BBO stream the per-window driver
 * should consume as the live-tick source. Live trading currently uses
 * `binance-perp`; replay accepts the others so we can run head-to-head
 * comparisons against alternative training sources (e.g. retrain on
 * coinbase-spot + replay against the same).
 */
export type ReplayTickSource =
  | "binance-perp"
  | "coinbase-spot"
  | "coinbase-perp"
  | "pyth-spot";

export type ReplayBaseFields = {
  readonly id: string;
  readonly tsMs: number;
  readonly receivedMs: number;
  readonly asset: Asset | null;
  readonly marketRef: string | null;
};

export type ReplayPolymarketBookEvent = ReplayBaseFields & {
  readonly source: "polymarket";
  readonly kind: "book";
  readonly event: MarketDataBookEvent;
};

export type ReplayPolymarketBestBidAskEvent = ReplayBaseFields & {
  readonly source: "polymarket";
  readonly kind: "best-bid-ask";
  readonly event: MarketDataBestBidAskEvent;
};

export type ReplayPolymarketTradeEvent = ReplayBaseFields & {
  readonly source: "polymarket";
  readonly kind: "trade";
  readonly event: MarketDataTradeEvent;
};

export type ReplayPolymarketResolvedEvent = ReplayBaseFields & {
  readonly source: "polymarket";
  readonly kind: "resolved";
  readonly event: MarketDataResolvedEvent;
};

export type ReplayBinancePerpBboEvent = ReplayBaseFields & {
  readonly source: "binance-perp";
  readonly kind: "bbo";
  readonly asset: Asset;
  readonly bid: number;
  readonly ask: number;
  readonly mid: number;
  readonly tsExchangeMs: number | null;
};

export type ReplayCoinbaseSpotBboEvent = ReplayBaseFields & {
  readonly source: "coinbase-spot";
  readonly kind: "bbo";
  readonly asset: Asset;
  readonly bid: number;
  readonly ask: number;
  readonly mid: number;
  readonly tsExchangeMs: number | null;
};

export type ReplayCoinbasePerpBboEvent = ReplayBaseFields & {
  readonly source: "coinbase-perp";
  readonly kind: "bbo";
  readonly asset: Asset;
  readonly bid: number;
  readonly ask: number;
  readonly mid: number;
  readonly tsExchangeMs: number | null;
};

/**
 * Pyth Hermes "BBO". Pyth is a multi-publisher oracle aggregate, not
 * a venue book — each captured tick carries a single price plus a
 * confidence interval. We collapse `bid = ask = mid = price` on the
 * capture side so this row shape is identical to the venue BBO
 * events; downstream consumers that only read `mid` work unchanged,
 * and consumers that need to spot the difference can switch on
 * `source === "pyth-spot"`.
 */
export type ReplayPythSpotBboEvent = ReplayBaseFields & {
  readonly source: "pyth-spot";
  readonly kind: "bbo";
  readonly asset: Asset;
  readonly bid: number;
  readonly ask: number;
  readonly mid: number;
  readonly tsExchangeMs: number | null;
};

export type ReplayChainlinkRefPriceEvent = ReplayBaseFields & {
  readonly source: "polymarket-chainlink";
  readonly kind: "reference-price";
  readonly asset: Asset;
  readonly value: number;
  readonly tsExchangeMs: number | null;
};

/**
 * One log row emitted by the replay runner. Mirrors `DryRunEvent` so
 * the existing dry-run formatter, analytical tools, and HTML report
 * loader work on a replay session unchanged. Replay-specific signal
 * (e.g. chainlink/polymarket settlement mismatches) is folded into the
 * `window-finalized` payload as additional fields rather than as new
 * top-level event kinds — additive, not breaking.
 */
export type ReplayRunEvent =
  | { readonly kind: "info"; readonly atMs: number; readonly message: string }
  | { readonly kind: "warn"; readonly atMs: number; readonly message: string }
  | { readonly kind: "error"; readonly atMs: number; readonly message: string }
  | {
      readonly kind: "decision";
      readonly atMs: number;
      readonly decision: TradeDecision;
    }
  | {
      readonly kind: "virtual-order";
      readonly atMs: number;
      readonly asset: Asset;
      readonly order: SimulatedDryOrder;
      readonly stakeUsd: number;
      readonly entryPrice: number;
      readonly line: number;
      readonly modelProbability: number;
      readonly edge: number | null;
      readonly body: string;
    }
  | {
      readonly kind: "virtual-fill";
      readonly atMs: number;
      readonly asset: Asset;
      readonly order: SimulatedDryOrder;
    }
  | {
      readonly kind: "window-finalized";
      readonly atMs: number;
      readonly windowStartMs: number;
      readonly windowEndMs: number;
      readonly metrics: DryAggregateMetrics;
      readonly sessionMetrics: DryAggregateMetrics;
      readonly body: string;
    };
