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

export const COINBASE_SPOT_STRATEGY_ID =
  "coinbase-spot-2026-05-08-single-table-taker";

export type CoinbaseSpotStrategy = {
  readonly id: typeof COINBASE_SPOT_STRATEGY_ID;
  readonly label: string;
  readonly placementMode: "taker";
  readonly assets: readonly Asset[];
  readonly table: ProbabilityTable;
  readonly decisionEvaluator: TradeDecisionEvaluator;
};

/**
 * Single-source replacement for `researchChallengerStrategy`. Reads
 * one probability table — the canonical `probabilityTable.generated.ts`,
 * which is trained on coinbase-spot 5m candles — and applies the same
 * execution-quality gates the consensus strategy did
 * (bestAsk ≤ 0.75, spread ≤ 0.07, same-side trend confirmation,
 * asset filter), without requiring four-source agreement.
 *
 * Built 2026-05-08 after measurement showed the binance/perp data
 * feed disagreed with Chainlink ~16% of the time across a 70h
 * captured window vs ~3.3% for coinbase/spot. The consensus design
 * needed binance/perp to be a useful diversifier; with that source
 * structurally noisy as a Chainlink proxy, the consensus was filtering
 * on bad signal. coinbase/spot alone is ~5x more accurate as a venue
 * proxy and matches what `trainingCandleSeries` already uses for
 * label generation, so going single-source aligns the live tracker,
 * the training labels, and the strategy on one feed.
 */
export const coinbaseSpotStrategy: CoinbaseSpotStrategy = {
  id: COINBASE_SPOT_STRATEGY_ID,
  label: "single coinbase/spot taker",
  placementMode: "taker",
  assets: RESEARCH_CHALLENGER_ASSETS,
  table: probabilityTable,
  decisionEvaluator: evaluateCoinbaseSpotDecision,
};

export function evaluateCoinbaseSpotDecision(
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
