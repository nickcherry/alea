import {
  LIVE_TRADING_REGIME_ALGOS,
  MIN_ACTIONABLE_DISTANCE_BP,
  MIN_MODEL_PROBABILITY,
} from "@alea/constants/trading";
import { flooredRemainingMinutes } from "@alea/lib/livePrices/fiveMinuteWindow";
import type {
  DecisionSnapshot,
  SideEdge,
  TradeDecision,
  WinningRegime,
} from "@alea/lib/trading/decision/types";
import {
  lookupAllProbabilities,
  type ProbabilityLookup,
} from "@alea/lib/trading/lookupProbability";
import type { LeadingSide, ProbabilityTable } from "@alea/lib/trading/types";
import type { RegimeClassifierInput } from "@alea/lib/training/regimeAlgos/types";
import type { Asset } from "@alea/types/assets";

export type DecisionInputsBase = {
  readonly asset: Asset;
  readonly windowStartMs: number;
  readonly nowMs: number;
  readonly line: number;
  readonly currentPrice: number;
  /**
   * Pre-computed regime-classifier input — `leadingSide` plus every
   * numeric feature the 5m lookback can produce (EMAs, ATRs, RSI,
   * prev-bar direction, …). Built by `computeRegimeClassifierInput`
   * over the per-asset bars buffer; the same code path the training
   * snapshot pipeline runs over historical candles. Algo classifiers
   * read what they need; missing values mean the bar buffer hasn't
   * seeded far enough for that feature.
   */
  readonly regimeInput: RegimeClassifierInput;
  /** Best bid for the up-YES token, or `null` if nothing is resting. */
  readonly upBestBid: number | null;
  /** Best bid for the down-YES token, or `null` if nothing is resting. */
  readonly downBestBid: number | null;
  /** Best ask for the up-YES token, when the caller has book context. */
  readonly upBestAsk?: number | null;
  /** Best ask for the down-YES token, when the caller has book context. */
  readonly downBestAsk?: number | null;
  readonly upTokenId: string;
  readonly downTokenId: string;
  readonly minEdge: number;
};

export type DecisionInputs = DecisionInputsBase & {
  readonly table: ProbabilityTable;
};

export type TradeDecisionEvaluator = (
  inputs: DecisionInputsBase,
) => TradeDecision;

/**
 * Pure decision evaluator implementing the multi-algo greedy strategy.
 *
 * 1. Floor `(now - windowStart)` to one of {1,2,3,4} minutes
 *    remaining. Out-of-window or pre-window → skip.
 * 2. Compute distance bp; below `MIN_ACTIONABLE_DISTANCE_BP` → skip.
 * 3. For each algo in `LIVE_TRADING_REGIME_ALGOS`, classify the
 *    snapshot. Algos whose classifier returns null (warmup, missing
 *    inputs) drop out.
 * 4. If no algo classified → skip (`warmup`).
 * 5. Look up every leading-regime table where the algo's
 *    classification matches the table's regime AND the bucket at
 *    `(remaining, distanceBp)` is populated. None matched → skip
 *    (`no-bucket`).
 * 6. For each (lookup, side), compute the edge against that side's
 *    bid. Across all (lookup, side) tuples, pick the maximum.
 * 7. Apply gates: max edge below `minEdge` → skip (`thin-edge`);
 *    chosen side's probability below `MIN_MODEL_PROBABILITY` →
 *    skip (`low-confidence`). No bid on either side → skip (`no-bid`).
 * 8. Otherwise: trade with the winning side at the winning bid.
 *
 * The "greedy" piece is step 6: any leading regime that gives us a
 * tradeable edge wins, even if other leading regimes for the same
 * snapshot would skip.
 */
export function evaluateDecision(inputs: DecisionInputs): TradeDecision {
  const remaining = flooredRemainingMinutes({
    windowStartMs: inputs.windowStartMs,
    nowMs: inputs.nowMs,
  });
  if (remaining === null) {
    return skipNoSnapshot("out-of-window");
  }

  const distanceAbs = Math.abs(inputs.currentPrice - inputs.line);
  const distanceBp = Math.floor((distanceAbs / inputs.line) * 10_000 + 1e-9);
  if (distanceBp < MIN_ACTIONABLE_DISTANCE_BP) {
    return skipNoSnapshot("too-close-to-line");
  }
  const currentSide: LeadingSide =
    inputs.currentPrice >= inputs.line ? "up" : "down";

  // Classify the snapshot under every live algo. Each algo reads
  // whatever fields it needs from the shared `regimeInput`; algos
  // whose required fields haven't seeded yet return null and drop
  // out of this snapshot.
  const regimesByAlgoId = new Map<string, string>();
  for (const algo of LIVE_TRADING_REGIME_ALGOS) {
    const regime = algo.classify(inputs.regimeInput);
    if (regime !== null) {
      regimesByAlgoId.set(algo.id, regime);
    }
  }

  const snapshot: DecisionSnapshot = {
    asset: inputs.asset,
    windowStartMs: inputs.windowStartMs,
    nowMs: inputs.nowMs,
    line: inputs.line,
    currentPrice: inputs.currentPrice,
    distanceBp,
    remaining,
    ema20: inputs.regimeInput.ema20,
    ema50: inputs.regimeInput.ema50,
    atr14: inputs.regimeInput.atr14,
    atr50: inputs.regimeInput.atr50,
    currentSide,
    regimesByAlgoId,
  };

  if (regimesByAlgoId.size === 0) {
    return skipWithSnapshot({
      reason: "warmup",
      snapshot,
      winningRegime: null,
      up: null,
      down: null,
    });
  }

  const lookups = lookupAllProbabilities({
    table: inputs.table,
    asset: inputs.asset,
    regimesByAlgoId,
    remaining,
    distanceBp,
  });
  if (lookups.length === 0) {
    return skipWithSnapshot({
      reason: "no-bucket",
      snapshot,
      winningRegime: null,
      up: null,
      down: null,
    });
  }

  // For each lookup × side, derive ourProbability + edge. Track the
  // overall winners on each side (for the diagnostic snapshot) plus
  // the absolute max-edge tuple (the trade we'd take).
  let bestUp: { lookup: ProbabilityLookup; edge: SideEdge } | null = null;
  let bestDown: { lookup: ProbabilityLookup; edge: SideEdge } | null = null;
  for (const lookup of lookups) {
    const ourProbCurrent = lookup.probability;
    const ourProbOther = 1 - ourProbCurrent;
    const ourProbUp = currentSide === "up" ? ourProbCurrent : ourProbOther;
    const ourProbDown = currentSide === "down" ? ourProbCurrent : ourProbOther;
    const upEdge: SideEdge = {
      side: "up",
      tokenId: inputs.upTokenId,
      bid: inputs.upBestBid,
      ourProbability: ourProbUp,
      edge: inputs.upBestBid === null ? null : ourProbUp - inputs.upBestBid,
    };
    const downEdge: SideEdge = {
      side: "down",
      tokenId: inputs.downTokenId,
      bid: inputs.downBestBid,
      ourProbability: ourProbDown,
      edge:
        inputs.downBestBid === null ? null : ourProbDown - inputs.downBestBid,
    };
    if (
      upEdge.edge !== null &&
      (bestUp === null ||
        (bestUp.edge.edge ?? Number.NEGATIVE_INFINITY) < upEdge.edge)
    ) {
      bestUp = { lookup, edge: upEdge };
    }
    if (
      downEdge.edge !== null &&
      (bestDown === null ||
        (bestDown.edge.edge ?? Number.NEGATIVE_INFINITY) < downEdge.edge)
    ) {
      bestDown = { lookup, edge: downEdge };
    }
  }

  // Diagnostic per-side edges shown on skip. Pick the per-side best
  // (or fall back to a no-bid placeholder so the dry-run log captures
  // which token had no resting bid).
  const upDiag: SideEdge =
    bestUp !== null
      ? bestUp.edge
      : noBidSide({
          side: "up",
          tokenId: inputs.upTokenId,
          bid: inputs.upBestBid,
          lookups,
          currentSide,
        });
  const downDiag: SideEdge =
    bestDown !== null
      ? bestDown.edge
      : noBidSide({
          side: "down",
          tokenId: inputs.downTokenId,
          bid: inputs.downBestBid,
          lookups,
          currentSide,
        });

  if (bestUp === null && bestDown === null) {
    return skipWithSnapshot({
      reason: "no-bid",
      snapshot,
      winningRegime: null,
      up: upDiag,
      down: downDiag,
    });
  }

  // Pick the side with the larger edge across all lookups.
  const upScore = bestUp?.edge.edge ?? Number.NEGATIVE_INFINITY;
  const downScore = bestDown?.edge.edge ?? Number.NEGATIVE_INFINITY;
  const winning = upScore >= downScore ? bestUp : bestDown;
  if (winning === null) {
    return skipWithSnapshot({
      reason: "no-bid",
      snapshot,
      winningRegime: null,
      up: upDiag,
      down: downDiag,
    });
  }
  const winningSideEdge = winning.edge;
  const otherSide: SideEdge = winningSideEdge.side === "up" ? downDiag : upDiag;
  const winningRegime: WinningRegime = {
    algoId: winning.lookup.algoId,
    regime: winning.lookup.regime,
    probability: winning.lookup.probability,
    samples: winning.lookup.samples,
  };
  if (winningSideEdge.edge === null || winningSideEdge.edge < inputs.minEdge) {
    return skipWithSnapshot({
      reason: "thin-edge",
      snapshot,
      winningRegime,
      up: upDiag,
      down: downDiag,
    });
  }
  if (winningSideEdge.ourProbability < MIN_MODEL_PROBABILITY) {
    return skipWithSnapshot({
      reason: "low-confidence",
      snapshot,
      winningRegime,
      up: upDiag,
      down: downDiag,
    });
  }
  return {
    kind: "trade",
    snapshot,
    winningRegime,
    chosen: winningSideEdge,
    other: otherSide,
  };
}

function skipNoSnapshot(
  reason: "out-of-window" | "too-close-to-line",
): TradeDecision {
  return {
    kind: "skip",
    reason,
    snapshot: null,
    winningRegime: null,
    up: null,
    down: null,
  };
}

function skipWithSnapshot({
  reason,
  snapshot,
  winningRegime,
  up,
  down,
}: {
  readonly reason:
    | "warmup"
    | "no-bucket"
    | "no-bid"
    | "thin-edge"
    | "low-confidence";
  readonly snapshot: DecisionSnapshot;
  readonly winningRegime: WinningRegime | null;
  readonly up: SideEdge | null;
  readonly down: SideEdge | null;
}): TradeDecision {
  return {
    kind: "skip",
    reason,
    snapshot,
    winningRegime,
    up,
    down,
  };
}

function noBidSide({
  side,
  tokenId,
  bid,
  lookups,
  currentSide,
}: {
  readonly side: LeadingSide;
  readonly tokenId: string;
  readonly bid: number | null;
  readonly lookups: readonly ProbabilityLookup[];
  readonly currentSide: LeadingSide;
}): SideEdge {
  // For the no-bid diagnostic edge, pick a representative
  // probability from the available lookups (the most-optimistic one,
  // matching the same selection rule as live trading would use). If
  // we have no lookups at all, default to 0 — the side will already
  // be flagged on the skip reason.
  let ourProb = 0;
  for (const lookup of lookups) {
    const fromLookup =
      currentSide === side ? lookup.probability : 1 - lookup.probability;
    if (fromLookup > ourProb) {
      ourProb = fromLookup;
    }
  }
  return {
    side,
    tokenId,
    bid,
    ourProbability: ourProb,
    edge: null,
  };
}
