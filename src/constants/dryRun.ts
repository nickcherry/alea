/**
 * Dry-run execution simulation knobs. These are deliberately separate
 * from the shared trade-decision constants: dry/live must agree on
 * when a signal is actionable, while dry-run has extra assumptions
 * about the simulated order sent after a filter decision.
 */

/** Delay after the filter decision before simulating order placement. */
export const DRY_RUN_ORDER_PLACEMENT_DELAY_MS = 0;

/** Maximum distance from 50c, in cents, where the simulated order is allowed. */
export const DRY_RUN_ORDER_PRICE_WINDOW_CENTS = 3;

/**
 * Limit price policy for simulated maker orders. The dry-run buys the
 * predicted-side token one tick below the predicted-side best ask. If no
 * predicted-side ask has arrived, it falls back to one tick below 50c.
 */
export const DRY_RUN_ORDER_LIMIT_PRICE_POLICY =
  "buy_predicted_side_one_tick_below_best_ask_or_one_tick_below_50c_if_missing" as const;

/** Reference price for no-quote fallback maker orders. */
export const DRY_RUN_ORDER_NO_QUOTE_REFERENCE_PRICE = 0.5;

/** Fallback tick size when discovery/WS metadata has not supplied one yet. */
export const DRY_RUN_ORDER_DEFAULT_TICK_SIZE = 0.01;

/**
 * Dry-run uses the latest known book/BBO quote instead of expiring quotes by age.
 * Missing placement quotes fall back one tick below
 * `DRY_RUN_ORDER_NO_QUOTE_REFERENCE_PRICE`.
 */
export const DRY_RUN_ORDER_MAX_QUOTE_AGE_MS = Number.MAX_SAFE_INTEGER;

/** How early the runner should discover target Polymarket markets. */
export const DRY_RUN_MARKET_DISCOVERY_LEAD_MS = 15 * 60 * 1000;

/** Same as `DRY_RUN_ORDER_PRICE_WINDOW_CENTS`, expressed as a 0..1 token price. */
export const DRY_RUN_ORDER_PRICE_WINDOW =
  DRY_RUN_ORDER_PRICE_WINDOW_CENTS / 100;

export const DRY_RUN_ORDER_STATUS_VALUES = [
  "untracked",
  "pending_placement",
  "skipped_no_market",
  "skipped_no_price",
  "skipped_price_window",
  "skipped_confidence",
  "placed",
  "filled",
  "unfilled",
] as const;

export type DryRunOrderStatus = (typeof DRY_RUN_ORDER_STATUS_VALUES)[number];
