import type {
  RegimeAlgo,
  RegimeClassifierInput,
  RegimeLabel,
} from "@alea/lib/training/regimeAlgos/types";

const LOW_CUT = 0.7;
const HIGH_CUT = 1.3;

const REGIMES = ["low_vol", "mid_vol", "high_vol"] as const satisfies readonly RegimeLabel[];

/**
 * Vol-only 3-bucket regime: refines the binary cut from `volOnly2Algo`
 * with an explicit `mid_vol` zone. Tests whether the binary `>1.0` cut
 * is too coarse — if `low_vol` and `mid_vol` survival rates are within
 * a percentage point, the binary cut was already in the right place.
 */
export const volOnly3Algo: RegimeAlgo = {
  id: "vol_only_3",
  displayName: "Vol only",
  description:
    "Three-bucket version of the calm-vs-choppy split, with an explicit middle zone for the everyday cases: calm (ATR-14 ÷ ATR-50 ≤ 0.7), middling (0.7–1.3), elevated (> 1.3). Lets the calm and elevated buckets focus on unambiguous extremes rather than borderline windows.",
  version: 1,
  regimes: REGIMES,
  params: { lowCut: LOW_CUT, highCut: HIGH_CUT },
  classify: ({ atr14, atr50 }: RegimeClassifierInput): RegimeLabel | null => {
    if (atr14 === null || atr50 === null) {
      return null;
    }
    if (atr14 <= 0 || atr50 <= 0) {
      return null;
    }
    const ratio = atr14 / atr50;
    if (ratio <= LOW_CUT) {
      return "low_vol";
    }
    if (ratio > HIGH_CUT) {
      return "high_vol";
    }
    return "mid_vol";
  },
};
