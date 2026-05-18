import {
  TRADE_DECISION_DEFAULT_ASSETS,
  TRADE_DECISION_SUPPORTED_PERIODS,
  type TradeDecisionPeriod,
} from "@alea/constants/tradeDecision";
import type { Asset } from "@alea/types/assets";

export const CANDIDATE_BACKTEST_START_MS = Date.UTC(2024, 0, 1);
export const CANDIDATE_BACKTEST_END_EXCLUSIVE_MS: number | null = null;

export const CANDIDATE_BACKTEST_ASSETS =
  TRADE_DECISION_DEFAULT_ASSETS satisfies readonly Asset[];

export const CANDIDATE_BACKTEST_PERIODS =
  TRADE_DECISION_SUPPORTED_PERIODS satisfies readonly TradeDecisionPeriod[];

export const CANDIDATE_BACKTEST_DECISION_SCHEMA_VERSION = 2;
// v8: outcome model flipped — decision now fires AT the entry candle's
// open (no synthetic, no lead time), filter inputs are closed bars
// only, and the win condition is "take-profit threshold hit within N
// candles" rather than "next-candle close direction." Bumping
// invalidates every v7 cache row.
export const CANDIDATE_BACKTEST_ENGINE_VERSION = 8;
