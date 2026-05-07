import type {
  RegimeAlgo,
  RegimeClassifierInput,
  RegimeLabel,
} from "@alea/lib/training/regimeAlgos/types";

const REGIMES = [
  "continuation",
  "reversion",
] as const satisfies readonly RegimeLabel[];

/**
 * Continuation-vs-reversion bar-carry split. `continuation` when the
 * current 5m window's leading side matches the prior completed bar's
 * direction (both up, or both down); `reversion` when they disagree.
 *
 * Motivation: overnight 2026-05-05 dry-run iter 4 showed today's filled
 * orders cleanly bifurcated by trade direction — continuation bets won
 * 84.6% / +$100, reversion bets won 7.7% / -$149 — but no existing algo
 * (vol-only, vol-quartiles, trend×vol) keys off this axis. Yesterday the
 * sign was reversed (reversion bets carried the PnL), so the regime is
 * real and swings day-to-day. This algo makes that axis explicit so the
 * persisted prob table can carry separate surfaces for the two cases.
 */
export const barCarry2Algo: RegimeAlgo = {
  id: "bar_carry_2",
  displayName: "Bar carry",
  description:
    "Two-bucket continuation-vs-reversion split: tags a window as `continuation` when its leading side aligns with the previous completed 5m bar's direction (e.g. price ≥ window open AND prior bar closed up), and `reversion` when they disagree. Targets the regime axis where today's market favors trend-followers and yesterday's favored mean-reverters — neither vol nor trend×vol captures this directly.",
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
    return leadingSide === prev5mDirection ? "continuation" : "reversion";
  },
};
