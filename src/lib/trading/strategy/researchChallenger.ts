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
import type {
  DecisionSnapshot,
  TradeDecision,
} from "@alea/lib/trading/decision/types";
import type { NamedProbabilityTable } from "@alea/lib/trading/probabilityTable/researchChallengerTables.generated";
import { researchChallengerProbabilityTables } from "@alea/lib/trading/probabilityTable/researchChallengerTables.generated";
import type { LeadingSide } from "@alea/lib/trading/types";
import type { Asset } from "@alea/types/assets";

export const RESEARCH_CHALLENGER_STRATEGY_ID =
  "research-challenger-2026-05-07-consensus-taker";

export type ResearchChallengerStrategy = {
  readonly id: typeof RESEARCH_CHALLENGER_STRATEGY_ID;
  readonly label: string;
  readonly placementMode: "taker";
  readonly assets: readonly Asset[];
  readonly tables: readonly NamedProbabilityTable[];
  readonly decisionEvaluator: TradeDecisionEvaluator;
};

export const researchChallengerStrategy: ResearchChallengerStrategy = {
  id: RESEARCH_CHALLENGER_STRATEGY_ID,
  label: "4-source consensus taker",
  placementMode: "taker",
  assets: RESEARCH_CHALLENGER_ASSETS,
  tables: researchChallengerProbabilityTables,
  decisionEvaluator: evaluateResearchChallengerDecision,
};

export function evaluateResearchChallengerDecision(
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

  const decisions = researchChallengerProbabilityTables.map((source) => ({
    source,
    decision: evaluateDecision({ ...inputs, table: source.table }),
  }));
  const trades = decisions.flatMap(({ source, decision }) =>
    decision.kind === "trade" ? [{ source, decision }] : [],
  );
  if (trades.length !== researchChallengerProbabilityTables.length) {
    return consensusSkip({
      decisions: decisions.map((entry) => entry.decision),
      reason: "no-consensus",
    });
  }

  const primary = trades[0]?.decision;
  if (primary === undefined) {
    return consensusSkip({
      decisions: decisions.map((entry) => entry.decision),
      reason: "no-consensus",
    });
  }
  const chosenSide = primary.chosen.side;
  if (!trades.every((entry) => entry.decision.chosen.side === chosenSide)) {
    return consensusSkip({
      decisions: trades.map((entry) => entry.decision),
      reason: "no-consensus",
    });
  }

  if (
    !passesExecutionQuality({ inputs, side: chosenSide, decision: primary })
  ) {
    return {
      kind: "skip",
      reason: "execution-quality",
      snapshot: primary.snapshot,
      winningRegime: primary.winningRegime,
      up: primary.chosen.side === "up" ? primary.chosen : primary.other,
      down: primary.chosen.side === "down" ? primary.chosen : primary.other,
    };
  }

  return primary;
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

function consensusSkip({
  decisions,
  reason,
}: {
  readonly decisions: readonly TradeDecision[];
  readonly reason: "no-consensus";
}): TradeDecision {
  const trade = decisions.find(
    (decision): decision is Extract<TradeDecision, { kind: "trade" }> =>
      decision.kind === "trade",
  );
  if (trade !== undefined) {
    return {
      kind: "skip",
      reason,
      snapshot: trade.snapshot,
      winningRegime: trade.winningRegime,
      up: trade.chosen.side === "up" ? trade.chosen : trade.other,
      down: trade.chosen.side === "down" ? trade.chosen : trade.other,
    };
  }
  const snapshotDecision = decisions.find(
    (
      decision,
    ): decision is Extract<TradeDecision, { kind: "skip" }> & {
      readonly snapshot: DecisionSnapshot;
    } => decision.kind === "skip" && decision.snapshot !== null,
  );
  if (snapshotDecision !== undefined) {
    return {
      kind: "skip",
      reason,
      snapshot: snapshotDecision.snapshot,
      winningRegime: snapshotDecision.winningRegime,
      up: snapshotDecision.up,
      down: snapshotDecision.down,
    };
  }
  const first = decisions[0];
  if (first?.kind === "skip") {
    return first;
  }
  return {
    kind: "skip",
    reason,
    snapshot: null,
    winningRegime: null,
    up: null,
    down: null,
  };
}

export function consensusSourceLabel(): string {
  return researchChallengerProbabilityTables
    .map((entry) => entry.name)
    .join(",");
}
