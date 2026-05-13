import {
  type CommitteeDecisionContext,
  type CommitteeDecisionRules,
  DEFAULT_COMMITTEE_DECISION_RULES,
} from "@alea/constants/tradeDecision";
import type {
  CandidateVote,
  CommitteeDecision,
} from "@alea/lib/committee/types";
import type { FilterPrediction } from "@alea/lib/filters/types";

type VoteTallies = Omit<CommitteeDecision, "prediction"> & {
  readonly upBestRank: number | null;
  readonly downBestRank: number | null;
};

type ShapeRule =
  | { readonly kind: "none" }
  | { readonly kind: "min-votes"; readonly minVotes: number }
  | {
      readonly kind: "min-votes-rank";
      readonly maxWinningBestRank: number;
      readonly minVotes: number;
    };

/**
 * Shared trade-decision vote policy. Multiple selected configs for
 * one filter are all evaluated, but only one active vote per filter
 * can reach the final tally. When several configs of the same filter
 * engage, the one with the strongest selected asset/regime win rate wins
 * the filter slot.
 *
 * After that filter collapse, the winning side must clear the
 * centralized minimum-vote and consensus constants. With the current
 * constants this is simple majority, with ties and all-abstain
 * returning `null`.
 */
export function aggregateCommittee({
  context,
  votes,
  rules = DEFAULT_COMMITTEE_DECISION_RULES,
}: {
  readonly context?: CommitteeDecisionContext;
  readonly votes: readonly CandidateVote[];
  readonly rules?: CommitteeDecisionRules;
}): CommitteeDecision {
  const tallies = tallyEffectiveVotes({ votes, rules });
  const prediction = resolvePrediction({
    context,
    up: tallies.up,
    upBestRank: tallies.upBestRank,
    down: tallies.down,
    downBestRank: tallies.downBestRank,
    rules,
  });
  return {
    prediction,
    up: tallies.up,
    down: tallies.down,
    abstain: tallies.abstain,
  };
}

export function selectEffectiveCommitteeVotes({
  votes,
  rules = DEFAULT_COMMITTEE_DECISION_RULES,
}: {
  readonly votes: readonly CandidateVote[];
  readonly rules?: CommitteeDecisionRules;
}): readonly CandidateVote[] {
  const byFilterId = selectEffectiveVotesByFilter({ votes, rules });
  return Array.from(byFilterId.values()).flat();
}

function tallyEffectiveVotes({
  votes,
  rules,
}: {
  readonly votes: readonly CandidateVote[];
  readonly rules: CommitteeDecisionRules;
}): VoteTallies {
  const byFilterId = selectEffectiveVotesByFilter({ votes, rules });
  let up = 0;
  let down = 0;
  let abstain = 0;
  let upBestRank: number | null = null;
  let downBestRank: number | null = null;
  for (const list of byFilterId.values()) {
    if (list.length === 0) {
      abstain += 1;
      continue;
    }
    for (const v of list) {
      if (v.prediction === "up") {
        up += 1;
        upBestRank = minRank(upBestRank, v.selection.rank);
      } else if (v.prediction === "down") {
        down += 1;
        downBestRank = minRank(downBestRank, v.selection.rank);
      }
    }
  }
  return { up, down, abstain, upBestRank, downBestRank };
}

function selectEffectiveVotesByFilter({
  votes,
  rules,
}: {
  readonly votes: readonly CandidateVote[];
  readonly rules: CommitteeDecisionRules;
}): ReadonlyMap<string, readonly CandidateVote[]> {
  const byFilterId = new Map<string, CandidateVote[]>();
  for (const vote of votes) {
    const filterId = vote.candidate.filterId;
    let selected = byFilterId.get(filterId);
    if (selected === undefined) {
      selected = [];
      byFilterId.set(filterId, selected);
    }
    if (vote.prediction !== null) {
      selected.push(vote);
    }
  }
  for (const [filterId, selected] of byFilterId) {
    if (selected.length <= rules.maxVotesPerFilter) {
      continue;
    }
    selected.sort(compareFilterVotes);
    byFilterId.set(filterId, selected.slice(0, rules.maxVotesPerFilter));
  }
  return byFilterId;
}

function compareFilterVotes(a: CandidateVote, b: CandidateVote): number {
  const aWinRate = a.selection.winRate ?? Number.NEGATIVE_INFINITY;
  const bWinRate = b.selection.winRate ?? Number.NEGATIVE_INFINITY;
  if (aWinRate !== bWinRate) {
    return bWinRate - aWinRate;
  }

  const aEngagements = a.selection.nEngagements ?? Number.NEGATIVE_INFINITY;
  const bEngagements = b.selection.nEngagements ?? Number.NEGATIVE_INFINITY;
  if (aEngagements !== bEngagements) {
    return bEngagements - aEngagements;
  }

  const aRank = a.selection.rank ?? Number.POSITIVE_INFINITY;
  const bRank = b.selection.rank ?? Number.POSITIVE_INFINITY;
  return aRank - bRank;
}

function resolvePrediction({
  context,
  downBestRank,
  up,
  upBestRank,
  down,
  rules,
}: {
  readonly context?: CommitteeDecisionContext;
  readonly downBestRank: number | null;
  readonly up: number;
  readonly upBestRank: number | null;
  readonly down: number;
  readonly rules: CommitteeDecisionRules;
}): FilterPrediction {
  const nonAbstain = up + down;
  if (up === down) {
    return null;
  }

  const prediction = up > down ? "up" : "down";
  const winningVotes = Math.max(up, down);
  const losingVotes = Math.min(up, down);
  const consensus = winningVotes / nonAbstain;
  if (
    isShapePolicy({ policyId: rules.policyId }) &&
    context !== undefined &&
    !acceptsShapePolicy({
      context,
      losingVotes,
      minVotesToTrade: rules.minVotesToTrade,
      nonAbstain,
      policyId: rules.policyId,
      winningBestRank: prediction === "up" ? upBestRank : downBestRank,
      winningVotes,
    })
  ) {
    return null;
  }
  if (
    (!isShapePolicy({ policyId: rules.policyId }) || context === undefined) &&
    nonAbstain < rules.minVotesToTrade
  ) {
    return null;
  }
  if (consensus < rules.minConsensusFraction) {
    return null;
  }
  return prediction;
}

function acceptsShapePolicy({
  context,
  losingVotes,
  minVotesToTrade,
  nonAbstain,
  policyId,
  winningBestRank,
  winningVotes,
}: {
  readonly context: CommitteeDecisionContext;
  readonly losingVotes: number;
  readonly minVotesToTrade: number;
  readonly nonAbstain: number;
  readonly policyId: CommitteeDecisionRules["policyId"];
  readonly winningBestRank: number | null;
  readonly winningVotes: number;
}): boolean {
  if (
    policyId === "shape-v3" ||
    policyId === "shape-v4" ||
    policyId === "shape-v5"
  ) {
    return acceptsMappedShapeRule({
      context,
      nonAbstain,
      policyId,
      winningBestRank,
    });
  }

  // Shape policies keep normal two-vote decisions, trim weak
  // high-vol-trending shapes, and admit selected one-vote shapes that held
  // up in month and even/odd holdout splits.
  if (
    nonAbstain === 1 &&
    isOneVoteShapeAllowed({
      asset: context.asset,
      marketRegime: context.marketRegime,
      policyId,
      period: context.period,
    })
  ) {
    return true;
  }

  if (nonAbstain < minVotesToTrade) {
    return false;
  }

  if (context.marketRegime !== "high_vol_trending") {
    return true;
  }

  if (context.asset === "xrp" && context.period === "5m") {
    return false;
  }

  return (
    context.period === "5m" &&
    losingVotes === 0 &&
    (winningVotes === 2 || winningVotes === 3)
  );
}

function isShapePolicy({
  policyId,
}: {
  readonly policyId: CommitteeDecisionRules["policyId"];
}): boolean {
  return (
    policyId === "shape-v1" ||
    policyId === "shape-v2" ||
    policyId === "shape-v3" ||
    policyId === "shape-v4" ||
    policyId === "shape-v5"
  );
}

function acceptsMappedShapeRule({
  context,
  nonAbstain,
  policyId,
  winningBestRank,
}: {
  readonly context: CommitteeDecisionContext;
  readonly nonAbstain: number;
  readonly policyId: CommitteeDecisionRules["policyId"];
  readonly winningBestRank: number | null;
}): boolean {
  const rule =
    policyId === "shape-v5"
      ? shapeV5RuleFor(context)
      : policyId === "shape-v4"
        ? shapeV4RuleFor(context)
        : shapeV3RuleFor(context);
  switch (rule.kind) {
    case "none":
      return false;
    case "min-votes":
      return nonAbstain >= rule.minVotes;
    case "min-votes-rank":
      return (
        nonAbstain >= rule.minVotes &&
        winningBestRank !== null &&
        winningBestRank <= rule.maxWinningBestRank
      );
  }
}

function shapeV3RuleFor({
  asset,
  marketRegime,
  period,
}: CommitteeDecisionContext): ShapeRule {
  const key = `${asset}|${period}|${marketRegime}`;
  switch (key) {
    case "btc|15m|high_vol_trending":
    case "btc|5m|low_vol_trending":
    case "doge|15m|low_vol_trending":
    case "doge|5m|low_vol_ranging":
    case "eth|5m|low_vol_ranging":
    case "sol|15m|low_vol_ranging":
    case "sol|5m|high_vol_trending":
    case "xrp|5m|low_vol_trending":
      return { kind: "min-votes", minVotes: 2 };
    case "sol|15m|high_vol_trending":
    case "xrp|15m|low_vol_trending":
    case "xrp|5m|low_vol_ranging":
      return { kind: "min-votes", minVotes: 3 };
    case "btc|15m|low_vol_ranging":
    case "btc|15m|low_vol_trending":
    case "doge|15m|low_vol_ranging":
    case "eth|15m|low_vol_trending":
    case "eth|5m|high_vol_trending":
    case "eth|5m|low_vol_trending":
    case "sol|15m|low_vol_trending":
      return { kind: "min-votes", minVotes: 1 };
    case "doge|5m|low_vol_trending":
    case "xrp|15m|high_vol_trending":
    case "xrp|15m|low_vol_ranging":
      return {
        kind: "min-votes-rank",
        maxWinningBestRank: 4,
        minVotes: 1,
      };
    case "sol|5m|low_vol_trending":
      return {
        kind: "min-votes-rank",
        maxWinningBestRank: 6,
        minVotes: 1,
      };
    default:
      return { kind: "none" };
  }
}

function shapeV4RuleFor({
  asset,
  marketRegime,
  period,
}: CommitteeDecisionContext): ShapeRule {
  const key = `${asset}|${period}|${marketRegime}`;
  switch (key) {
    case "btc|15m|low_vol_ranging":
    case "doge|15m|low_vol_ranging":
    case "eth|15m|low_vol_trending":
    case "eth|5m|high_vol_trending":
    case "sol|15m|high_vol_trending":
      return { kind: "min-votes", minVotes: 1 };
    case "btc|5m|low_vol_trending":
    case "doge|15m|low_vol_trending":
    case "doge|5m|low_vol_ranging":
    case "eth|5m|low_vol_ranging":
    case "sol|15m|low_vol_ranging":
    case "sol|5m|high_vol_trending":
    case "xrp|5m|low_vol_trending":
      return { kind: "min-votes", minVotes: 2 };
    case "doge|5m|low_vol_trending":
    case "xrp|15m|high_vol_trending":
    case "xrp|15m|low_vol_ranging":
      return {
        kind: "min-votes-rank",
        maxWinningBestRank: 4,
        minVotes: 1,
      };
    case "sol|5m|low_vol_trending":
      return {
        kind: "min-votes-rank",
        maxWinningBestRank: 6,
        minVotes: 1,
      };
    case "btc|15m|high_vol_trending":
    case "btc|15m|low_vol_trending":
    case "eth|5m|low_vol_trending":
    case "sol|15m|low_vol_trending":
    case "xrp|5m|low_vol_ranging":
      return {
        kind: "min-votes-rank",
        maxWinningBestRank: 8,
        minVotes: 1,
      };
    default:
      return { kind: "none" };
  }
}

function shapeV5RuleFor({
  asset,
  marketRegime,
  period,
}: CommitteeDecisionContext): ShapeRule {
  const key = `${asset}|${period}|${marketRegime}`;
  switch (key) {
    case "btc|15m|low_vol_ranging":
    case "doge|15m|low_vol_ranging":
    case "eth|15m|low_vol_trending":
    case "eth|5m|high_vol_trending":
    case "sol|15m|high_vol_trending":
    case "xrp|15m|low_vol_trending":
      return { kind: "min-votes", minVotes: 1 };
    case "btc|5m|low_vol_trending":
    case "doge|15m|low_vol_trending":
    case "doge|5m|low_vol_ranging":
    case "doge|5m|low_vol_trending":
    case "eth|5m|low_vol_ranging":
    case "sol|15m|low_vol_ranging":
    case "sol|5m|high_vol_trending":
    case "xrp|5m|low_vol_trending":
      return { kind: "min-votes", minVotes: 2 };
    case "xrp|15m|high_vol_trending":
    case "xrp|15m|low_vol_ranging":
      return {
        kind: "min-votes-rank",
        maxWinningBestRank: 4,
        minVotes: 1,
      };
    case "sol|5m|low_vol_trending":
      return {
        kind: "min-votes-rank",
        maxWinningBestRank: 6,
        minVotes: 1,
      };
    case "btc|15m|high_vol_trending":
    case "btc|15m|low_vol_trending":
    case "eth|15m|high_vol_trending":
    case "eth|5m|low_vol_trending":
    case "sol|15m|low_vol_trending":
    case "xrp|5m|low_vol_ranging":
      return {
        kind: "min-votes-rank",
        maxWinningBestRank: 8,
        minVotes: 1,
      };
    default:
      return { kind: "none" };
  }
}

function minRank(current: number | null, next: number | null): number | null {
  if (next === null || !Number.isFinite(next)) {
    return current;
  }
  return current === null ? next : Math.min(current, next);
}

function isOneVoteShapeAllowed({
  asset,
  marketRegime,
  policyId,
  period,
}: Pick<CommitteeDecisionContext, "asset" | "marketRegime" | "period"> & {
  readonly policyId: CommitteeDecisionRules["policyId"];
}): boolean {
  if (policyId === "shape-v1") {
    return (
      (asset === "eth" &&
        period === "5m" &&
        marketRegime === "high_vol_trending") ||
      (period === "15m" &&
        marketRegime === "low_vol_trending" &&
        (asset === "btc" || asset === "eth" || asset === "doge"))
    );
  }

  if (policyId === "shape-v2") {
    return (
      (asset === "eth" &&
        period === "5m" &&
        (marketRegime === "high_vol_trending" ||
          marketRegime === "low_vol_trending")) ||
      (asset === "sol" &&
        period === "5m" &&
        marketRegime === "low_vol_trending") ||
      (period === "15m" &&
        marketRegime === "low_vol_trending" &&
        (asset === "btc" || asset === "eth" || asset === "sol"))
    );
  }

  return false;
}
