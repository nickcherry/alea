/**
 * Dry-run execution simulation knobs. These are deliberately separate
 * from the shared trade-decision constants: dry/live must agree on
 * when a signal is actionable, while dry-run has extra assumptions
 * about the pretend order we would have sent after the market opened.
 */

/** Delay after the target Polymarket window opens before simulating order placement. */
export const DRY_RUN_ORDER_PLACEMENT_DELAY_MS = 1 * 1000;

/** Maximum distance from 50c, in cents, where the simulated order is allowed. */
export const DRY_RUN_ORDER_PRICE_WINDOW_CENTS = 3;

/**
 * Limit price policy for simulated maker orders. The dry-run buys the
 * predicted-side token one tick below the predicted-side best ask. That is
 * the most aggressive buy we can model while still resting as maker-only.
 */
export const DRY_RUN_ORDER_LIMIT_PRICE_POLICY =
  "buy_predicted_side_one_tick_below_best_ask" as const;

/** Fallback tick size when discovery/WS metadata has not supplied one yet. */
export const DRY_RUN_ORDER_DEFAULT_TICK_SIZE = 0.01;

/** Maximum age for book/BBO quotes used at simulated placement/fill time. */
export const DRY_RUN_ORDER_MAX_QUOTE_AGE_MS = 2 * 1000;

/** How early the runner should discover target Polymarket markets. */
export const DRY_RUN_MARKET_DISCOVERY_LEAD_MS = 30 * 1000;

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
