import type { MarketBar } from "@alea/lib/marketSeries/types";

export type TradeOutcome = "win" | "loss";

/**
 * The trade outcome under the take-profit / stop-loss / time-stop
 * model.
 *
 * `entryPrice` is the open of the entry candle. `outcomeBars` is that
 * entry candle plus the next N-1 candles (so the entry candle counts
 * toward the window).
 *
 * For a long:
 *   - TP price = entry * (1 + takeProfitPct)
 *   - SL price = entry * (1 - stopLossPct)
 * For a short: signs flip.
 *
 * The trade is a *win* if the TP price is touched *before* the SL
 * price somewhere inside the window. Within a single bar OHLC cannot
 * tell us which side was touched first; the convention here is the
 * conservative one — if both are inside the bar's range, the SL is
 * treated as hit first. This avoids overstating wins on volatile
 * bars where price actually round-tripped past SL before reaching TP.
 *
 * If neither TP nor SL is touched by the end of the window, the
 * time-stop fires and the trade is a *loss*.
 */
export function resolveTradeOutcome({
  direction,
  entryPrice,
  outcomeBars,
  takeProfitPct,
  stopLossPct,
}: {
  readonly direction: "up" | "down";
  readonly entryPrice: number;
  readonly outcomeBars: readonly MarketBar[];
  readonly takeProfitPct: number;
  readonly stopLossPct: number;
}): TradeOutcome {
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
    throw new Error("entryPrice must be a positive finite number");
  }
  if (!Number.isFinite(takeProfitPct) || takeProfitPct <= 0) {
    throw new Error("takeProfitPct must be a positive finite number");
  }
  if (!Number.isFinite(stopLossPct) || stopLossPct <= 0) {
    throw new Error("stopLossPct must be a positive finite number");
  }
  if (direction === "up") {
    const tp = entryPrice * (1 + takeProfitPct);
    const sl = entryPrice * (1 - stopLossPct);
    for (const bar of outcomeBars) {
      if (bar.low <= sl) {
        return "loss";
      }
      if (bar.high >= tp) {
        return "win";
      }
    }
    return "loss";
  }
  const tp = entryPrice * (1 - takeProfitPct);
  const sl = entryPrice * (1 + stopLossPct);
  for (const bar of outcomeBars) {
    if (bar.high >= sl) {
      return "loss";
    }
    if (bar.low <= tp) {
      return "win";
    }
  }
  return "loss";
}
