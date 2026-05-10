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
