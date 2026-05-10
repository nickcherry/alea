import type {
  RegimeAlgo,
  RegimeClassifierInput,
  RegimeLabel,
} from "@alea/lib/training/regimeAlgos/types";
import { volOnly3Algo } from "@alea/lib/training/regimeAlgos/volOnly3";

/**
 * Five candidate "vol × <axis>" cross-product algos for the next
 * round of regime research. All five share the same base partition —
 * `vol_only_3` (low/mid/high) — and add one secondary axis on top.
 * The hypothesis: `vol_only_3` is the strongest single-axis signal we
 * have, but its three buckets blur outcomes that a simple binary or
 * ternary conditioning would separate. Each axis below uses only
 * scalars already on `RegimeClassifierInput`, so no live-runner
 * plumbing is required.
 *
 * Bucket counts:
 *   - emaTrend6  : 3 vol × 2 trend     = 6
 *   - barCarry6  : 3 vol × 2 carry     = 6
 *   - atrAccel6  : 3 vol × 2 accel     = 6
 *   - rsiAlign6  : 3 vol × 2 rsi-align = 6
 *   - rsiZone9   : 3 vol × 3 rsi-zone  = 9
 *
 * After the divergence experiment, we know thin buckets get
 * filtered out by `REGIME_CELL_MIN_SAMPLES`. The 6-bucket variants
 * fragment more gently than the 15-bucket vol×rsi-div did; the
 * 9-bucket rsiZone9 is the most aggressive, included as the
 * highest-fragmentation tolerable variant.
 */

const VOL_LABELS = volOnly3Algo.regimes as readonly RegimeLabel[]; // ["low_vol","mid_vol","high_vol"]

function classifyVol(input: RegimeClassifierInput): RegimeLabel | null {
  return volOnly3Algo.classify(input);
}

function combinedLabels<T extends string>(
  axisLabels: readonly T[],
): readonly RegimeLabel[] {
  return VOL_LABELS.flatMap((v) => axisLabels.map((a) => `${v}_${a}`));
}

// ─────────────────────────────────────────────────────────────────
// Axis 1 — vol acceleration (binary)
// "accel":   ATR-3 > ATR-14 (recent vol exceeding the medium-term
//            baseline — vol is rising into this window).
// "decel":   ATR-3 ≤ ATR-14 (vol stable or falling).
// Mechanism: `vol_only_3` is a regime label about *level*. This axis
// captures *direction* — is vol rising or falling into the window.
// The two together let us separate "low-vol-but-rising" from "low-
// vol-and-stable", which behave differently in practice.
// ─────────────────────────────────────────────────────────────────
const ATR_ACCEL_LABELS = ["accel", "decel"] as const;
const atrAccel6: RegimeAlgo = {
  id: "vol3_x_atr_accel_6",
  displayName: "Vol × ATR accel",
  description:
    "Six-bucket cross-product of vol_only_3 and a binary "
    + "vol-acceleration split: 'accel' when ATR-3 > ATR-14 (recent vol "
    + "rising into the window), 'decel' otherwise. The vol axis is a "
    + "*level* signal; this axis is *direction* — together they "
    + "separate 'low-vol-but-rising' from 'low-vol-and-stable', which "
    + "have different downstream survival shapes.",
  version: 1,
  regimes: combinedLabels(ATR_ACCEL_LABELS),
  params: { volLowCut: 0.7, volHighCut: 1.3 },
  classify: (input) => {
    const vol = classifyVol(input);
    if (vol === null) {
      return null;
    }
    const { atr3, atr14 } = input;
    if (atr3 === null || atr14 === null || atr14 <= 0) {
      return null;
    }
    const axis = atr3 > atr14 ? "accel" : "decel";
    return `${vol}_${axis}`;
  },
};

// ─────────────────────────────────────────────────────────────────
// Axis 2 — side vs RSI alignment (binary)
// "with_rsi": leadingSide is up and RSI > 50, OR side is down and
//             RSI < 50 (price moves with momentum oscillator).
// "vs_rsi":   they disagree (price moving against RSI).
// Mechanism: complementary to side-vs-EMA-trend. RSI captures
// shorter-window oscillator-style momentum; EMA captures
// longer-window trend. Two separate angles on "is the side aligned
// with momentum".
// ─────────────────────────────────────────────────────────────────
const RSI_ALIGN_LABELS = ["with_rsi", "vs_rsi"] as const;
const rsiAlign6: RegimeAlgo = {
  id: "vol3_x_rsi_align_6",
  displayName: "Vol × RSI align",
  description:
    "Six-bucket cross-product of vol_only_3 and a binary side-vs-RSI "
    + "alignment: 'with_rsi' when up-side + RSI > 50 OR down-side + "
    + "RSI < 50 (price moving with momentum), 'vs_rsi' when they "
    + "disagree. RSI is a shorter-window oscillator than the EMA pair; "
    + "this axis is to side-vs-EMA-trend what a fast moving average is "
    + "to a slow one.",
  version: 1,
  regimes: combinedLabels(RSI_ALIGN_LABELS),
  params: { volLowCut: 0.7, volHighCut: 1.3 },
  classify: (input) => {
    const vol = classifyVol(input);
    if (vol === null) {
      return null;
    }
    if (input.rsi14 === null) {
      return null;
    }
    const rsiUp = input.rsi14 > 50;
    const sideUp = input.leadingSide === "up";
    const axis = rsiUp === sideUp ? "with_rsi" : "vs_rsi";
    return `${vol}_${axis}`;
  },
};

// ─────────────────────────────────────────────────────────────────
// Axis 3 — combined: ATR-accel × RSI-align (12 buckets)
// Cross-product of the two strongest single-axis signals from round
// 1 (atr_accel_6 mean −1.9pp asymmetric, rsi_align_6 mean +1.7pp
// asymmetric). 3 vol × 2 atr-accel × 2 rsi-align = 12 buckets.
// Hypothesis: if the two axes carry independent signal, combining
// them stratifies outcomes more sharply than either alone — and the
// mean calibrationScore should land above both individual variants
// (round 1: atr_accel 0.00114, rsi_align 0.00099, vol_only 0.00093).
// If combining doesn't beat the better individual axis, the two
// signals are correlated and a single-axis variant is enough.
// ─────────────────────────────────────────────────────────────────
const ATR_RSI_LABELS = [
  "accel_with_rsi",
  "accel_vs_rsi",
  "decel_with_rsi",
  "decel_vs_rsi",
] as const;
const atrAccelXRsiAlign12: RegimeAlgo = {
  id: "vol3_x_atr_accel_rsi_align_12",
  displayName: "Vol × ATR accel × RSI align",
  description:
    "Twelve-bucket triple cross-product: vol_only_3 (3) × ATR "
    + "acceleration (accel/decel, 2) × side-vs-RSI alignment "
    + "(with_rsi/vs_rsi, 2). Combines the two strongest single-axis "
    + "signals from round 1 (atr-accel was −1.9pp asymmetric, "
    + "rsi-align was +1.7pp asymmetric, both consistently across "
    + "BTC/ETH/SOL/XRP). Tests whether the two axes are independent "
    + "(combining sharpens) or correlated (combining just fragments).",
  version: 1,
  regimes: combinedLabels(ATR_RSI_LABELS),
  params: { volLowCut: 0.7, volHighCut: 1.3 },
  classify: (input) => {
    const vol = classifyVol(input);
    if (vol === null) {
      return null;
    }
    const { atr3, atr14, rsi14, leadingSide } = input;
    if (atr3 === null || atr14 === null || atr14 <= 0 || rsi14 === null) {
      return null;
    }
    const accel = atr3 > atr14 ? "accel" : "decel";
    const sideUp = leadingSide === "up";
    const rsiUp = rsi14 > 50;
    const align = sideUp === rsiUp ? "with_rsi" : "vs_rsi";
    return `${vol}_${accel}_${align}`;
  },
};

export const volX = {
  atrAccel6,
  rsiAlign6,
  atrAccelXRsiAlign12,
};
