import type {
  RegimeAlgo,
  RegimeClassifierInput,
  RegimeLabel,
} from "@alea/lib/training/regimeAlgos/types";

const REGIMES = ["with_carry", "against_carry"] as const satisfies readonly RegimeLabel[];

/**
 * Carry from the previous COMPLETED 5m bar's direction: `with_carry`
 * when the leading side matches the previous bar's direction (the
 * 5m window is opening with momentum in the leading side's favor),
 * `against_carry` when they disagree (the leading side is fighting
 * the prior bar's direction).
 *
 * Tests whether short-term momentum carry from the prior bar predicts
 * survival rate. Different signal entirely from EMA-based trend
 * (which spans 20–50 bars) — pure 5-min carry.
 */
export const prevBarCarry2Algo: RegimeAlgo = {
  id: "prev_bar_carry_2",
  displayName: "Previous-bar carry",
  description:
    "Two-bucket split on whether the leading side is moving with or against the most recently completed 5-minute bar (up if its close finished at or above its open, otherwise down). A pure short-term momentum check that lives on a totally different timescale from the slower EMA-based trend signals.",
  version: 1,
  regimes: REGIMES,
  params: {},
  classify: ({
    leadingSide,
    prev5mDirection,
  }: RegimeClassifierInput): RegimeLabel | null => {
    if (prev5mDirection === null) {
      return null;
    }
    return leadingSide === prev5mDirection ? "with_carry" : "against_carry";
  },
};
