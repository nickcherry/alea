import {
  RESEARCH_CHALLENGER_ASSETS,
  RESEARCH_CHALLENGER_MAX_CHOSEN_BEST_ASK,
  RESEARCH_CHALLENGER_MAX_CHOSEN_SPREAD,
  RESEARCH_CHALLENGER_MIN_TREND_CONFIRM_BP,
} from "@alea/constants/trading";
import {
  type DecisionInputsBase,
  evaluateDecision,
  type TradeDecisionEvaluator,
} from "@alea/lib/trading/decision/evaluateDecision";
import type { TradeDecision } from "@alea/lib/trading/decision/types";
import { probabilityTable } from "@alea/lib/trading/probabilityTable/probabilityTable.generated";
import type { LeadingSide, ProbabilityTable } from "@alea/lib/trading/types";
import type { Asset } from "@alea/types/assets";

export const SINGLE_SOURCE_TAKER_STRATEGY_ID =
  "pyth-spot-2026-05-08-single-table-taker";

export type SingleSourceTakerStrategy = {
  readonly id: typeof SINGLE_SOURCE_TAKER_STRATEGY_ID;
  readonly label: string;
  readonly placementMode: "taker";
  readonly assets: readonly Asset[];
  readonly table: ProbabilityTable;
  readonly decisionEvaluator: TradeDecisionEvaluator;
};

/**
 * Single-source replacement for `researchChallengerStrategy`. Reads
 * one probability table — the canonical `probabilityTable.generated.ts`,
 * which is trained on the source named in `trainingCandleSeries` —
 * and applies the same execution-quality gates the consensus strategy
 * did (bestAsk ≤ 0.75, spread ≤ 0.07, same-side trend confirmation,
 * asset filter), without requiring four-source agreement.
 *
 * Source history:
 * - 2026-05-08 v1: built on coinbase/spot, after measurement showed
 *   binance/perp disagreed with Chainlink ~16% of the time across a
 *   70h captured window vs ~3.3% for coinbase/spot. The consensus
 *   design needed binance/perp to be a useful diversifier; with that
 *   source structurally noisy as a Chainlink proxy, the consensus was
 *   filtering on bad signal.
 * - 2026-05-08 v2: switched the trained probability table to pyth/spot.
 *   Pyth Network's multi-publisher median (Coinbase, Cboe, Wintermute,
 *   Virtu, etc) is architecturally the closest free analog of Chainlink
 *   Data Streams' reporter model, and across the same 70h window it
 *   disagreed with Chainlink only 1.89% of the time — strictly better
 *   than coinbase/spot (3.31%) on every asset, and dramatically better
 *   on the long tail (DOGE 12×, XRP 19×). See
 *   scripts/source_vs_chainlink.ts.
 * - 2026-05-09: live tick source moved to Pyth Hermes too. The earlier
 *   note that "live tick source stays coinbase/spot" was based on a
 *   misread that Pyth had no streaming API; in fact Hermes serves the
 *   same multi-publisher aggregate over SSE at ~430ms cadence (one
 *   Solana slot). Live in-window state and the trained table are now
 *   both reading from the same feed. See `livePrices/pyth/`.
 */
export const singleSourceTakerStrategy: SingleSourceTakerStrategy = {
  id: SINGLE_SOURCE_TAKER_STRATEGY_ID,
  label: "single pyth/spot taker",
  placementMode: "taker",
  assets: RESEARCH_CHALLENGER_ASSETS,
  table: probabilityTable,
  decisionEvaluator: evaluateSingleSourceTakerDecision,
};

export function evaluateSingleSourceTakerDecision(
  inputs: DecisionInputsBase,
): TradeDecision {
  if (!RESEARCH_CHALLENGER_ASSETS.includes(inputs.asset)) {
    return {
      kind: "skip",
      reason: "asset-excluded",
      snapshot: null,
      winningRegime: null,
      up: null,
      down: null,
    };
  }
  const decision = evaluateDecision({ ...inputs, table: probabilityTable });
  if (decision.kind !== "trade") {
    return decision;
  }
  if (
    !passesExecutionQuality({
      inputs,
      side: decision.chosen.side,
      decision,
    })
  ) {
    return {
      kind: "skip",
      reason: "execution-quality",
      snapshot: decision.snapshot,
      winningRegime: decision.winningRegime,
      up: decision.chosen.side === "up" ? decision.chosen : decision.other,
      down: decision.chosen.side === "down" ? decision.chosen : decision.other,
    };
  }
  return decision;
}

function passesExecutionQuality({
  inputs,
  side,
  decision,
}: {
  readonly inputs: DecisionInputsBase;
  readonly side: LeadingSide;
  readonly decision: Extract<TradeDecision, { kind: "trade" }>;
}): boolean {
  if (decision.snapshot.currentSide !== side) {
    return false;
  }
  if (decision.snapshot.distanceBp < RESEARCH_CHALLENGER_MIN_TREND_CONFIRM_BP) {
    return false;
  }
  const bestBid = side === "up" ? inputs.upBestBid : inputs.downBestBid;
  const bestAsk = side === "up" ? inputs.upBestAsk : inputs.downBestAsk;
  if (bestBid === null || bestAsk === undefined || bestAsk === null) {
    return false;
  }
  const spread = bestAsk - bestBid;
  if (!Number.isFinite(spread) || spread < 0) {
    return false;
  }
  return (
    bestAsk <= RESEARCH_CHALLENGER_MAX_CHOSEN_BEST_ASK &&
    spread <= RESEARCH_CHALLENGER_MAX_CHOSEN_SPREAD
  );
}
