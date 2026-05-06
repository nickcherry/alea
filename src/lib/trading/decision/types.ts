import type { LeadingSide, RemainingMinutes } from "@alea/lib/trading/types";
import type { Asset } from "@alea/types/assets";

/**
 * Identifies which leading-regime table produced the probability that
 * won out at decision time. Threaded onto the trade snapshot so the
 * dry-run log can record "vol_only_2 / low_vol won at 78.4% on a 0.55
 * conviction floor" for post-hoc analysis.
 */
export type WinningRegime = {
  readonly algoId: string;
  readonly regime: string;
  readonly probability: number;
  readonly samples: number;
};

/**
 * Per-snapshot data computed from the live feed and the moving
 * trackers. The decision evaluator and the dry-run logger both
 * consume this same shape — there's no second layer that re-derives
 * `regimesByAlgoId` or `distanceBp` from raw inputs.
 *
 * `regimesByAlgoId` is the per-algo classification of the snapshot —
 * one entry for each algo in `LIVE_TRADING_REGIME_ALGOS` whose
 * classifier returned non-null for this snapshot. The decision
 * evaluator iterates leading-regime tables and matches them against
 * this map to find the (algo, regime) pairs that fire.
 *
 * `winningRegime` (on trade decisions) records which (algo, regime)
 * table produced the chosen edge.
 *
 * `ema20`, `ema50`, `atr14`, `atr50` are retained on the snapshot for
 * diagnostic logging; the decision keys off the regime classifications,
 * not the raw inputs.
 */
export type DecisionSnapshot = {
  readonly asset: Asset;
  readonly windowStartMs: number;
  readonly nowMs: number;
  readonly line: number;
  readonly currentPrice: number;
  readonly distanceBp: number;
  readonly remaining: RemainingMinutes;
  readonly ema20: number | null;
  readonly ema50: number | null;
  readonly atr14: number | null;
  readonly atr50: number | null;
  readonly currentSide: LeadingSide;
  /**
   * Map of `algoId → regime label` for every algo that classified the
   * snapshot. Algos whose classify() returned null (warmup) are
   * absent.
   */
  readonly regimesByAlgoId: ReadonlyMap<string, string>;
};

/**
 * Per-side edge breakdown. `bid === null` means there are no resting
 * orders on that token's bid side; we cannot post a maker buy if we
 * have nothing to lean on.
 */
export type SideEdge = {
  readonly side: LeadingSide;
  readonly tokenId: string;
  readonly bid: number | null;
  readonly ourProbability: number;
  readonly edge: number | null;
};

/**
 * Reasons the evaluator declined to place a trade. Each reason is
 * emitted at most once per call so the caller can switch on it cleanly.
 *
 *   - `warmup` — no algo classified the snapshot (every classifier
 *     returned null because trackers haven't seeded yet).
 *   - `no-bucket` — at least one algo classified, but none of the
 *     leading-regime tables had a populated bucket at this
 *     `(remaining, distanceBp)` for the regimes the snapshot fits.
 *   - `no-bid` — no resting bid on either side; can't place maker.
 *   - `thin-edge` — best edge across all leading tables is below
 *     `MIN_EDGE`.
 *   - `low-confidence` — best edge clears `MIN_EDGE` but the chosen
 *     side's probability is below `MIN_MODEL_PROBABILITY`.
 *   - `too-close-to-line` — distance below `MIN_ACTIONABLE_DISTANCE_BP`.
 *   - `out-of-window` — `(now - windowStart)` is outside [1, 5)m.
 */
export type DecisionSkipReason =
  | "warmup"
  | "out-of-window"
  | "too-close-to-line"
  | "no-bucket"
  | "no-bid"
  | "thin-edge"
  | "low-confidence";

export type TradeDecision =
  | {
      readonly kind: "trade";
      readonly snapshot: DecisionSnapshot;
      readonly winningRegime: WinningRegime;
      readonly chosen: SideEdge;
      readonly other: SideEdge;
    }
  | {
      readonly kind: "skip";
      readonly reason: DecisionSkipReason;
      readonly snapshot: DecisionSnapshot | null;
      readonly winningRegime: WinningRegime | null;
      readonly up: SideEdge | null;
      readonly down: SideEdge | null;
    };
