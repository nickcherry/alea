import type {
  RegimeAlgo,
  RegimeClassifierInput,
  RegimeLabel,
} from "@alea/lib/training/regimeAlgos/types";

const WEAK_CUT = 0.5;
const STRONG_CUT = 1.5;

const REGIMES = [
  "no_trend",
  "weak_trend",
  "strong_trend",
] as const satisfies readonly RegimeLabel[];

/**
 * Trend strength by magnitude regardless of direction: |EMA20 − EMA50|
 * normalized by ATR-14. Cuts at 0.5 (no trend) and 1.5 (strong trend).
 *
 * Tests whether trend MAGNITUDE matters even when trend DIRECTION
 * doesn't (the trendOnly3 algo found with-trend ≈ against-trend on
 * average). If `strong_trend` and `weak_trend` survive at meaningfully
 * different rates, we have a direction-agnostic trend signal worth
 * using; if not, trend is not the right axis at all.
 */
export const trendStrength3Algo: RegimeAlgo = {
  id: "trend_strength_3",
  displayName: "Trend strength",
  description:
    "Three-bucket split on how strong the trend is, ignoring which direction it points. Strength is the gap between the EMA-20 and EMA-50 measured in ATR-14 units, bucketed as flat (< 0.5), modest trend (0.5–1.5), or strong trend (> 1.5). Asks whether the size of a trend matters even when its direction doesn't.",
  version: 1,
  regimes: REGIMES,
  params: { weakCut: WEAK_CUT, strongCut: STRONG_CUT },
  classify: ({
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
    const strength = Math.abs(ema20 - ema50) / atr14;
    if (strength < WEAK_CUT) {
      return "no_trend";
    }
    if (strength <= STRONG_CUT) {
      return "weak_trend";
    }
    return "strong_trend";
  },
};
