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
export const LIVE_TRADING_MARKET_DISCOVERY_LEAD_MS = 5 * 60 * 1000;

/** Maximum allowed distance from 50c for a live maker order. */
export const LIVE_TRADING_ORDER_PRICE_WINDOW_CENTS = 3;

/** Same as `LIVE_TRADING_ORDER_PRICE_WINDOW_CENTS`, as a 0..1 token price. */
export const LIVE_TRADING_ORDER_PRICE_WINDOW =
  LIVE_TRADING_ORDER_PRICE_WINDOW_CENTS / 100;

/**
 * Live placement uses the latest known book/BBO quote from the pre-open
 * subscription, even if the book has not changed recently. If no predicted-side
 * ask has arrived at all, it falls back to one tick below 50c.
 */
export const LIVE_TRADING_ORDER_MAX_QUOTE_AGE_MS = Number.MAX_SAFE_INTEGER;

/** Reference price for no-quote fallback maker orders. */
export const LIVE_TRADING_ORDER_NO_QUOTE_REFERENCE_PRICE = 0.5;

/** Fallback tick size when market metadata has not supplied one yet. */
export const LIVE_TRADING_ORDER_DEFAULT_TICK_SIZE = 0.01;

/** Maximum number of order placement attempts per decision. */
export const LIVE_TRADING_MAX_ORDER_ATTEMPTS = 800;

/**
 * Keep retrying through the market boundary when the venue says the market is
 * not ready yet, matching-engine restarts, rate limits, or transient network
 * failures occur.
 */
export const LIVE_TRADING_ORDER_RETRY_AFTER_OPEN_MS = 2500;

/** Minimum retry window for late decisions. */
export const LIVE_TRADING_ORDER_MIN_RETRY_WINDOW_MS = 1000;

/** Delay between failed live order placement retries. */
export const LIVE_TRADING_ORDER_RETRY_DELAY_MS = 50;

/** First retry delay after venue rate limiting. Scales linearly by attempt. */
export const LIVE_TRADING_ORDER_RATE_LIMIT_RETRY_BASE_MS = 500;

/** First retry delay after transient 5xx/network style venue failures. */
export const LIVE_TRADING_ORDER_TRANSIENT_RETRY_BASE_MS = 250;

/** Upper bound for adaptive live-order retry sleeps. */
export const LIVE_TRADING_ORDER_MAX_RETRY_DELAY_MS = 2_000;

/** Keep recently closed market sessions briefly so late frames can settle. */
export const LIVE_TRADING_SESSION_GRACE_MS = 5_000;
