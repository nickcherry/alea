import type {
  RegimeAlgo,
  RegimeClassifierInput,
  RegimeLabel,
} from "@alea/lib/training/regimeAlgos/types";

/**
 * Threshold separating the "no-trend" zone from the directional zones.
 * `|EMA20 - EMA50| / ATR14 < TREND_BAND_ATR` → no-trend. The ATR
 * normalization makes the threshold scale-free across assets.
 *
 * Default 0.5 = "less than half a typical 5m swing of EMA separation"
 * counts as flat. Tune via the dashboard once we have side-by-side
 * regime-algo comparisons.
 */
const TREND_BAND_ATR = 0.5;

/**
 * Threshold separating low-vol from high-vol regimes. `ATR14 / ATR50 >
 * VOL_RATIO` → high-vol. Default 1.0 = "current vol above the longer
 * baseline" is high-vol; current vol at-or-below baseline is low-vol.
 */
const VOL_RATIO = 1.0;

const REGIMES = [
  "no_trend_low_vol",
  "no_trend_high_vol",
  "with_trend_low_vol",
  "with_trend_high_vol",
  "against_trend_low_vol",
  "against_trend_high_vol",
] as const satisfies readonly RegimeLabel[];

export const trendXVol6Algo: RegimeAlgo = {
  id: "trend_x_vol_6",
  displayName: "Trend × vol",
  description:
    "The richest split: tags every window with both a trend label and a vol label, then crosses them. Trend axis looks at the gap between the EMA-20 and EMA-50 (scaled by ATR-14, cut at 0.5) and asks whether the leading side is riding the trend, fighting it, or whether there's no real trend to speak of; vol axis is the usual calm-vs-choppy cut (ATR-14 ÷ ATR-50 = 1.0). Six buckets in total — informative when trend and vol interact, but spreads the data thin.",
  version: 1,
  regimes: REGIMES,
  params: {
    trendBandAtr: TREND_BAND_ATR,
    volRatio: VOL_RATIO,
  },
  classify: ({
    leadingSide,
    ema20,
    ema50,
    atr14,
    atr50,
  }: RegimeClassifierInput): RegimeLabel | null => {
    if (
      ema20 === null ||
      ema50 === null ||
      atr14 === null ||
      atr50 === null
    ) {
      return null;
    }
    if (atr14 <= 0 || atr50 <= 0) {
      return null;
    }
    const trendStrength = (ema20 - ema50) / atr14;
    const volBucket = atr14 / atr50 > VOL_RATIO ? "high_vol" : "low_vol";
    if (Math.abs(trendStrength) < TREND_BAND_ATR) {
      return `no_trend_${volBucket}` as RegimeLabel;
    }
    const trendDirection = trendStrength > 0 ? "up" : "down";
    const trendBucket =
      leadingSide === trendDirection ? "with_trend" : "against_trend";
    return `${trendBucket}_${volBucket}` as RegimeLabel;
  },
};
