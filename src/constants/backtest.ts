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
// v9: outcome model gained a stop-loss leg. TP and SL are now
// per-candidate (set via `defineCandidate`); each cache row carries
// its own TP/SL. The candidate's `configCanon` now folds in TP/SL,
// so the cache hash invalidates automatically when either changes.
// v10: outcomeWindowBars is now per-candidate too. The candidate's
// `configCanon` folds it in alongside TP/SL.
export const CANDIDATE_BACKTEST_ENGINE_VERSION = 10;
