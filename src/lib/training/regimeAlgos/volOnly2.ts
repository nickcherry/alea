import type {
  RegimeAlgo,
  RegimeClassifierInput,
  RegimeLabel,
} from "@alea/lib/training/regimeAlgos/types";

/**
 * Threshold separating low-vol from high-vol regimes. Same convention
 * and default as `trendXVol6Algo` (`ATR14 / ATR50 > 1.0` → high-vol)
 * so the dashboard comparison stays apples-to-apples — any difference
 * in calibration or spread between this algo and the 6-bucket version
 * is purely the cost of the trend axis.
 */
const VOL_RATIO = 1.0;

const REGIMES = ["low_vol", "high_vol"] as const satisfies readonly RegimeLabel[];

/**
 * Vol-only 2-bucket regime algo. Drops the trend axis entirely; splits
 * snapshots only by `ATR14 / ATR50`. Tests the hypothesis that the vol
 * axis is the primary signal in `trendXVol6Algo` and the trend axis is
 * barely contributing — if this algo's max win-rate spread is close to
 * the 6-bucket algo's, the trend axis isn't pulling weight and a
 * vol-only production model would be both simpler and less sparse.
 */
export const volOnly2Algo: RegimeAlgo = {
  id: "vol_only_2",
  displayName: "Vol only",
  description:
    "Sorts windows by how lively the market has been lately compared with its longer-term baseline: calm when recent average swing size sits at or below the slower one, choppy when it's above (cut at ATR-14 ÷ ATR-50 = 1.0). The simplest possible vol split — a baseline the more elaborate vol algos have to beat.",
  version: 1,
  regimes: REGIMES,
  params: {
    volRatio: VOL_RATIO,
  },
  classify: ({
    atr14,
    atr50,
  }: RegimeClassifierInput): RegimeLabel | null => {
    if (atr14 === null || atr50 === null) {
      return null;
    }
    if (atr14 <= 0 || atr50 <= 0) {
      return null;
    }
    return atr14 / atr50 > VOL_RATIO ? "high_vol" : "low_vol";
  },
};
