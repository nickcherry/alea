import {
  formatTradeDecisionMarkets,
  MAX_COMMITTEE_VOTES_PER_FILTER,
  MIN_COMMITTEE_CONSENSUS_FRACTION,
  MIN_COMMITTEE_VOTES_TO_TRADE,
  TRADE_DECISION_ALLOWED_MARKET_REGIMES,
  TRADE_DECISION_DEFAULT_MARKETS,
} from "@alea/constants/tradeDecision";
import { TRAINING_PROFILE_ID } from "@alea/constants/training";
import { DEFAULT_COMMITTEE_SELECTION_RULES } from "@alea/lib/committee/selection/types";

export const COMMITTEE_BACKTEST_SCHEMA_VERSION = 5;

export const COMMITTEE_BACKTEST_PROFILE_ID = [
  `committee-replay-v${COMMITTEE_BACKTEST_SCHEMA_VERSION}`,
  `training=${TRAINING_PROFILE_ID}`,
  `markets=${formatTradeDecisionMarkets({ markets: TRADE_DECISION_DEFAULT_MARKETS })}`,
  `selection=minEngagements${DEFAULT_COMMITTEE_SELECTION_RULES.minEngagements}-wr${DEFAULT_COMMITTEE_SELECTION_RULES.minAggregateWinRate}-worstQ${DEFAULT_COMMITTEE_SELECTION_RULES.minWorstQuarterWinRate}-top${DEFAULT_COMMITTEE_SELECTION_RULES.topN}`,
  `regimes=${TRADE_DECISION_ALLOWED_MARKET_REGIMES.join(",")}`,
  `maxVotesPerFilter=${MAX_COMMITTEE_VOTES_PER_FILTER}`,
  `minVotes=${MIN_COMMITTEE_VOTES_TO_TRADE}`,
  `minConsensus=${MIN_COMMITTEE_CONSENSUS_FRACTION}`,
].join("|");
