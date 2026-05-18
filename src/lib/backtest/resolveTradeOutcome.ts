import type { MarketBar } from "@alea/lib/marketSeries/types";

export type TradeOutcome = "win" | "loss";

/**
 * The trade outcome under the take-profit-within-N-bars model.
 *
 * `entryPrice` is the open of the entry candle. `outcomeBars` is that
 * entry candle plus the next N-1 candles (so the entry candle counts
 * toward the window).
 *
 * The trade is a *win* if at any point inside any of those candles
 * the price touches the take-profit threshold:
 *   long  → some bar.high >= entryPrice * (1 + takeProfitPct)
 *   short → some bar.low  <= entryPrice * (1 - takeProfitPct)
 *
 * Otherwise the trade is a *loss* (the time-stop fires at the end of
 * the window without TP being touched). No price-stop is modeled.
 */
export function resolveTradeOutcome({
  direction,
  entryPrice,
  outcomeBars,
  takeProfitPct,
}: {
  readonly direction: "up" | "down";
  readonly entryPrice: number;
  readonly outcomeBars: readonly MarketBar[];
  readonly takeProfitPct: number;
}): TradeOutcome {
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
    throw new Error("entryPrice must be a positive finite number");
  }
  if (!Number.isFinite(takeProfitPct) || takeProfitPct <= 0) {
    throw new Error("takeProfitPct must be a positive finite number");
  }
  if (direction === "up") {
    const target = entryPrice * (1 + takeProfitPct);
    for (const bar of outcomeBars) {
      if (bar.high >= target) {
        return "win";
      }
    }
    return "loss";
  }
  const target = entryPrice * (1 - takeProfitPct);
  for (const bar of outcomeBars) {
    if (bar.low <= target) {
      return "win";
    }
  }
  return "loss";
}
