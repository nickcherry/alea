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
// v4: registered Extension Reversal candidate added to the live set; bump so
// dashboards rebuild rows for the new candidate alongside the rest.
// v5: Extension Reversal bumped to v2 — config gained `allowedDirection` +
// `minStreakLength`; registered config now restricts to "up" (fade
// down-extensions) per the asymmetry finding.
// v6: Tightened registered Extension Reversal `minSynthReturnPct` from 0.02
// to 0.025 (161 decisions / 68.32% WR vs. 256 / 65.23%).
// v7: Extension Reversal bumped to v3 — adds `minConfluenceCount` config and
// a cross-asset gate. Filter framework's `FilterEvaluationContext` gained an
// optional `crossAssetSeries` field; backtest harness populates it. Second
// registered candidate `extension_reversal-confluence` uses
// `minConfluenceCount=3` to trade only on broad-market downside extensions.
export const CANDIDATE_BACKTEST_ENGINE_VERSION = 7;
