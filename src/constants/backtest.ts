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

export const CANDIDATE_BACKTEST_DECISION_SCHEMA_VERSION = 1;
// v3: decision timing flipped — target candle is the *next* (not-yet-open)
// 1h bar; synthetic bar represents the in-progress *prior* hour, not the
// target. See doc/DECISION_TIMING.md. Bumping invalidates all v2 cache rows.
export const CANDIDATE_BACKTEST_ENGINE_VERSION = 3;
