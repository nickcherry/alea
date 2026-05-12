/**
 * Dry-run execution simulation knobs. These are deliberately separate
 * from the shared trade-decision constants: dry/live must agree on
 * when a signal is actionable, while dry-run has extra assumptions
 * about the pretend order we would have sent after the market opened.
 */

/** Delay after the target Polymarket window opens before simulating order placement. */
export const DRY_RUN_ORDER_PLACEMENT_DELAY_MS = 3 * 1000;

/** Maximum distance from 50c, in cents, where the simulated order is allowed. */
export const DRY_RUN_ORDER_PRICE_WINDOW_CENTS = 3;

/** Limit-buy offset above the observed predicted-side token price, in cents. */
export const DRY_RUN_ORDER_LIMIT_OFFSET_CENTS = 0.5;

/** Same as `DRY_RUN_ORDER_PRICE_WINDOW_CENTS`, expressed as a 0..1 token price. */
export const DRY_RUN_ORDER_PRICE_WINDOW =
  DRY_RUN_ORDER_PRICE_WINDOW_CENTS / 100;

/** Same as `DRY_RUN_ORDER_LIMIT_OFFSET_CENTS`, expressed as a 0..1 token price. */
export const DRY_RUN_ORDER_LIMIT_OFFSET =
  DRY_RUN_ORDER_LIMIT_OFFSET_CENTS / 100;

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
