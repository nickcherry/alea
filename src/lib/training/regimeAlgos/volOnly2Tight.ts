import type {
  RegimeAlgo,
  RegimeClassifierInput,
  RegimeLabel,
} from "@alea/lib/training/regimeAlgos/types";

const LOW_CUT = 0.85;
const HIGH_CUT = 1.15;

const REGIMES = ["low_vol", "high_vol"] as const satisfies readonly RegimeLabel[];

/**
 * Same idea as `volOnly2Algo` but skips the ambiguous mid-vol zone
 * (ratio between 0.85 and 1.15) entirely — those snapshots return
 * `null` and never contribute to either bucket. The hypothesis: the
 * binary 1.0 cut leaks borderline cases into both buckets, blurring
 * the signal. Skipping them sharpens both halves at the cost of
 * trading less often.
 *
 * If this beats `volOnly2Algo` on calibration, the cleaner cut is
 * worth the lost coverage — the live trader was already trading on
 * mis-classified marginal cases.
 */
export const volOnly2TightAlgo: RegimeAlgo = {
  id: "vol_only_2_tight",
  displayName: "Vol only · skip middle",
  description:
    "Two-bucket vol split with a deadband: low_vol when ATR-14 ÷ ATR-50 ≤ 0.85, high_vol when > 1.15. Snapshots in the 0.85–1.15 zone are skipped (return null) and never enter either bucket. Sharper boundary at the cost of coverage.",
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
    return null;
  },
};
