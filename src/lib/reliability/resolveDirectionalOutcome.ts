import type { DirectionalOutcome } from "@alea/lib/reliability/types";

/**
 * Polymarket crypto up/down markets and the trading code both treat equality
 * as an Up win.
 */
export function resolveDirectionalOutcome({
  startPrice,
  endPrice,
}: {
  readonly startPrice: number;
  readonly endPrice: number;
}): DirectionalOutcome {
  return endPrice >= startPrice ? "up" : "down";
}
