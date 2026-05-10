import type { ClosedFiveMinuteBar } from "@alea/lib/livePrices/types";
import type { LeadingSide } from "@alea/lib/trading/types";
import { build5mLookback } from "@alea/lib/training/computeSurvivalSnapshots";
import type { RegimeClassifierInput } from "@alea/lib/training/regimeAlgos/types";
import type { Candle } from "@alea/types/candles";

/**
 * Builds a full `RegimeClassifierInput` from a rolling buffer of
 * recently-closed 5m bars. Reuses the same `build5mLookback` index the
 * training-side snapshot pipeline runs over the historical candles —
 * which means every input the lookback can compute (EMA-20/50,
 * ATR-3/14/50, RSI-14, prev-bar direction, and anything we add later)
 * is automatically available at decision time. No per-input live
 * tracker, no `LIVE_AVAILABLE_INPUTS` registry, no per-algo
 * feasibility check.
 *
 * Returns nulls in every numeric field when the buffer hasn't seeded
 * far enough yet — the algo classifier decides whether that's a
 * skip or a default bucket.
 *
 * Performance: the lookback is O(buffer.length) per call; for a 70-bar
 * buffer this is negligible compared to live-decision cadence.
 */
export function computeRegimeClassifierInput({
  recentBars,
  windowStartMs,
  leadingSide,
}: {
  readonly recentBars: readonly ClosedFiveMinuteBar[];
  readonly windowStartMs: number;
  readonly leadingSide: LeadingSide;
}): RegimeClassifierInput {
  const empty: RegimeClassifierInput = {
    leadingSide,
    ema20: null,
    ema50: null,
    atr14: null,
    atr50: null,
    atr3: null,
    rsi14: null,
    prev5mDirection: null,
    rsiDivergence5mW3: null,
    rsiDivergence5mW5: null,
    rsiDivergence5mW7: null,
    rsiDivergence15mW3: null,
    rsiDivergence15mW5: null,
    rsiDivergence15mW7: null,
  };
  if (recentBars.length === 0) {
    return empty;
  }
  const lookback = build5mLookback({ candles5m: adaptLiveBars(recentBars) });
  if (lookback === null) {
    return empty;
  }
  const prevBar = lookback.prevBarAt({ windowStartMs });
  const prev5mDirection: "up" | "down" | null =
    prevBar === null ? null : prevBar.close >= prevBar.open ? "up" : "down";
  return {
    leadingSide,
    ema20: lookback.ema20At({ windowStartMs }),
    ema50: lookback.ema50At({ windowStartMs }),
    atr14: lookback.atrAt({ windowStartMs, period: 14 }),
    atr50: lookback.atrAt({ windowStartMs, period: 50 }),
    atr3: lookback.atrAt({ windowStartMs, period: 3 }),
    rsi14: lookback.rsi14At({ windowStartMs }),
    prev5mDirection,
    // RSI divergence: reused from the same FiveMinuteIndex (same
    // pattern as `rsi14`). Labels return null whenever the live bar
    // buffer is too short to find any pivot pair clearing
    // `rangeLower`. Note: divergence variants are filtered out of
    // `LIVE_TRADING_REGIME_ALGOS` for now (see constants/trading.ts) —
    // populating these fields is forward-compatible plumbing so a
    // future "promote `rsi_div_*`" change is one line.
    rsiDivergence5mW3: lookback.rsiDivergenceLabelAt({
      windowStartMs,
      timeframe: "5m",
      lookbackBars: 3,
    }),
    rsiDivergence5mW5: lookback.rsiDivergenceLabelAt({
      windowStartMs,
      timeframe: "5m",
      lookbackBars: 5,
    }),
    rsiDivergence5mW7: lookback.rsiDivergenceLabelAt({
      windowStartMs,
      timeframe: "5m",
      lookbackBars: 7,
    }),
    rsiDivergence15mW3: lookback.rsiDivergenceLabelAt({
      windowStartMs,
      timeframe: "15m",
      lookbackBars: 3,
    }),
    rsiDivergence15mW5: lookback.rsiDivergenceLabelAt({
      windowStartMs,
      timeframe: "15m",
      lookbackBars: 5,
    }),
    rsiDivergence15mW7: lookback.rsiDivergenceLabelAt({
      windowStartMs,
      timeframe: "15m",
      lookbackBars: 7,
    }),
  };
}

/**
 * Maps live `ClosedFiveMinuteBar`s into the `Candle` shape
 * `build5mLookback` expects. Volume is set to 0 — the WS feed doesn't
 * currently capture volume on closed bars, and no regime algo reads
 * it. Adding volume capture is a separate enrichment if a
 * volume-aware algo lands.
 */
function adaptLiveBars(bars: readonly ClosedFiveMinuteBar[]): Candle[] {
  return bars.map((bar) => ({
    source: "binance",
    asset: bar.asset,
    product: "perp",
    timeframe: "5m",
    timestamp: new Date(bar.openTimeMs),
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: 0,
  }));
}
