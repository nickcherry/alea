/**
 * Constants the trading layer still consults after the 2026-05-10
 * reset to the filter-committee framework. Everything regime / lookup
 * / model-probability related is gone with the old strategy.
 */

/** Polymarket pays $1 per winning YES share on resolution. */
export const WINNING_YES_PAYOUT_USD = 1;

/**
 * Maker-only path → 0 fees. Kept as a named constant so any future
 * fee model has one place to land instead of magic zeros sprinkled
 * through PnL math.
 */
export const MAKER_FEE_RATE = 0;

/** Per-trade stake in USD. */
export const STAKE_USD = 20;

/** How early live trading starts resolving and subscribing next markets. */
export const LIVE_TRADING_MARKET_DISCOVERY_LEAD_MS = 60 * 1000;

/** Maximum allowed distance from 50c for a live maker order. */
export const LIVE_TRADING_ORDER_PRICE_WINDOW_CENTS = 3;

/** Same as `LIVE_TRADING_ORDER_PRICE_WINDOW_CENTS`, as a 0..1 token price. */
export const LIVE_TRADING_ORDER_PRICE_WINDOW =
  LIVE_TRADING_ORDER_PRICE_WINDOW_CENTS / 100;

/** Maximum age for book/BBO quotes used for live order placement. */
export const LIVE_TRADING_ORDER_MAX_QUOTE_AGE_MS = 2 * 1000;

/** Fallback tick size when market metadata has not supplied one yet. */
export const LIVE_TRADING_ORDER_DEFAULT_TICK_SIZE = 0.01;

/** Maximum number of post-open order placement attempts per decision. */
export const LIVE_TRADING_MAX_ORDER_ATTEMPTS = 10;

/** Delay between failed live order placement retries. */
export const LIVE_TRADING_ORDER_RETRY_DELAY_MS = 75;
