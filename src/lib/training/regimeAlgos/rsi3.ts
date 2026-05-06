import type {
  RegimeAlgo,
  RegimeClassifierInput,
  RegimeLabel,
} from "@alea/lib/training/regimeAlgos/types";

const OVERSOLD_CUT = 30;
const OVERBOUGHT_CUT = 70;

const REGIMES = [
  "oversold",
  "neutral",
  "overbought",
] as const satisfies readonly RegimeLabel[];

/**
 * RSI extremes regime: oversold (RSI ≤ 30), neutral (30 < RSI < 70),
 * overbought (RSI ≥ 70). Conventional RSI thresholds; momentum-based
 * signal that's orthogonal to vol and trend (RSI is gain/loss balance,
 * not return magnitude).
 *
 * NOTE: the live decision path passes `rsi14: null` so this algo
 * cannot be `LIVE_TRADING_REGIME_ALGO` until a live RSI tracker is
 * wired through `RegimeTrackers`. It's strictly a dashboard
 * comparison algo until then.
 */
export const rsi3Algo: RegimeAlgo = {
  id: "rsi_3",
  displayName: "RSI extremes",
  description:
    "Three-bucket split on momentum extremes via the 14-period Wilder RSI of 5m closes: oversold (RSI ≤ 30), neutral (30 < RSI < 70), overbought (RSI ≥ 70).",
  version: 1,
  regimes: REGIMES,
  params: { oversoldCut: OVERSOLD_CUT, overboughtCut: OVERBOUGHT_CUT },
  classify: ({ rsi14 }: RegimeClassifierInput): RegimeLabel | null => {
    if (rsi14 === null) {
      return null;
    }
    if (rsi14 <= OVERSOLD_CUT) {
      return "oversold";
    }
    if (rsi14 >= OVERBOUGHT_CUT) {
      return "overbought";
    }
    return "neutral";
  },
};
