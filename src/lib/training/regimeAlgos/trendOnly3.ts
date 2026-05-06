import type {
  RegimeAlgo,
  RegimeClassifierInput,
  RegimeLabel,
} from "@alea/lib/training/regimeAlgos/types";

/**
 * Threshold separating the "no-trend" zone from the directional zones.
 * Same convention as `trendXVol6Algo` — `|EMA20 - EMA50| / ATR14 <
 * TREND_BAND_ATR` → no-trend.
 *
 * Default 0.5 = "less than half a typical 5m swing of EMA separation"
 * counts as flat. Kept identical to the 6-bucket algo's threshold so
 * the dashboard comparison is apples-to-apples.
 */
const TREND_BAND_ATR = 0.5;

const REGIMES = [
  "no_trend",
  "with_trend",
  "against_trend",
] as const satisfies readonly RegimeLabel[];

/**
 * Trend-only 3-bucket regime algo: leading-side relative to EMA-20 vs
 * EMA-50 trend, no vol sub-axis. Acts as the dashboard sanity check
 * for `trendXVol6Algo` — if the vol axis isn't carrying signal, this
 * algo's per-bucket metrics will be near-identical to the 6-bucket
 * version's pooled-by-trend numbers.
 */
export const trendOnly3Algo: RegimeAlgo = {
  id: "trend_only_3",
  displayName: "Trend only",
  description:
    "Three-bucket split on whether the leading side is riding or fighting the EMA-20 vs EMA-50 trend, with a no-trend bucket for windows where the trend is too faint to call (|EMA-20 − EMA-50| ÷ ATR-14 < 0.5). Only direction matters here — a roaring trend and a gentle one in the same direction land in the same bucket.",
  version: 1,
  regimes: REGIMES,
  params: {
    trendBandAtr: TREND_BAND_ATR,
  },
  classify: ({
    leadingSide,
    ema20,
    ema50,
    atr14,
  }: RegimeClassifierInput): RegimeLabel | null => {
    if (ema20 === null || ema50 === null || atr14 === null) {
      return null;
    }
    if (atr14 <= 0) {
      return null;
    }
    const trendStrength = (ema20 - ema50) / atr14;
    if (Math.abs(trendStrength) < TREND_BAND_ATR) {
      return "no_trend";
    }
    const trendDirection = trendStrength > 0 ? "up" : "down";
    return leadingSide === trendDirection ? "with_trend" : "against_trend";
  },
};
