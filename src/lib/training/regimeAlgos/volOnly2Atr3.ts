import type {
  RegimeAlgo,
  RegimeClassifierInput,
  RegimeLabel,
} from "@alea/lib/training/regimeAlgos/types";

const VOL_RATIO = 1.0;

const REGIMES = ["low_vol", "high_vol"] as const satisfies readonly RegimeLabel[];

/**
 * Same shape as `volOnly2Algo` but with ATR-3 in the numerator instead
 * of ATR-14. ATR-3 reacts more quickly to recent shocks; if the live
 * vol regime is genuinely about *current* turbulence, this should win.
 * If the slower ATR-14 already captures everything that matters, the
 * two algos will tie or this one will lose to noise.
 */
export const volOnly2Atr3Algo: RegimeAlgo = {
  id: "vol_only_2_atr3",
  displayName: "Vol only · ATR-3 numerator",
  description:
    "Two-bucket vol split using a faster numerator: low_vol when ATR-3 ÷ ATR-50 ≤ 1.0, high_vol when > 1.0. Asks whether very-short-window turbulence is a sharper vol signal than the smoother 14-bar window.",
  version: 1,
  regimes: REGIMES,
  params: { volRatio: VOL_RATIO },
  classify: ({ atr3, atr50 }: RegimeClassifierInput): RegimeLabel | null => {
    if (atr3 === null || atr50 === null) {
      return null;
    }
    if (atr3 <= 0 || atr50 <= 0) {
      return null;
    }
    return atr3 / atr50 > VOL_RATIO ? "high_vol" : "low_vol";
  },
};
