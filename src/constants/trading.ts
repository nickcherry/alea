import { regimeAlgos } from "@alea/lib/training/regimeAlgos/registry";
import type { RegimeAlgo } from "@alea/lib/training/regimeAlgos/types";

/**
 * Single home for every tunable constant the trading strategy depends
 * on — live decision thresholds, regime-algo promotion gates, and the
 * shared sample floor that the gen-table filter, the dashboard chart,
 * and the dashboard's lead-pp stats all read. Deliberately not
 * env-driven: every value here is part of the strategy itself, so it's
 * committed to version control and reviewable in diffs. Operational
 * secrets (wallet keys, db urls) still live in `env.ts`; nothing about
 * *how* the bot trades does.
 *
 * Adding a new lever: declare it here, import from
 * `@alea/constants/trading` everywhere it's read. Local aliases /
 * shadow constants in other files are a guaranteed source of drift —
 * don't add them.
 */

/**
 * Minimum sample count for a probability-table bucket to be considered
 * tradable. Buckets thinner than this fall in the noisy tail of the
 * distribution (very-far-from-line distances with only a handful of
 * historical observations); we treat them as "no signal" and never trade.
 */
export const MIN_BUCKET_SAMPLES = 200;

/**
 * Minimum bp distance from the price line at which we'll *engage* —
 * either count the snapshot toward training calibration or act on it
 * in live trading. Snapshots within `[0, MIN_ACTIONABLE_DISTANCE_BP)`
 * bp of the line are treated as if they don't exist for both purposes.
 *
 * Why: very near the line, win-rate is mechanically close to 50/50
 * regardless of filter (the price hasn't committed). Predictions
 * there carry no real edge over a coinflip, and the sample-rich noise
 * floor was inflating headline numbers in earlier versions of the
 * scoring. Excluding this band is a cleaner statement of "don't trade
 * when it could go either way" than relying on the modeled edge to
 * happen to fall below `MIN_EDGE` for those buckets.
 *
 * Set to 2 bp (≈$20 on a $100k BTC line). Bumping this value is a
 * meaningful policy change — it directly shrinks the actionable
 * snapshot population — so it lives here as a committed constant
 * rather than a flag.
 *
 * Both the training-side scoring (`computeSweetSpot`,
 * `scoreHalfVsBaseline`, `natsSavedVsGlobal`) and the live trader
 * (`evaluateDecision` skip rule, plus the probability-table
 * generation that drops sub-floor buckets) reference this constant
 * directly so the rule is identical end-to-end.
 */
export const MIN_ACTIONABLE_DISTANCE_BP = 2;

/**
 * Minimum edge over the market for the bot to take a trade. "Edge" =
 * `ourProbability − marketImpliedProbability` for the side we'd buy.
 * Below this threshold we don't bother — the spread, slippage, and
 * model error eat any thin edge.
 *
 * Expressed as an absolute probability gap (e.g. `0.05` = 5pp). Tune
 * this against backtests and live calibration.
 */
export const MIN_EDGE = 0.05;

/**
 * Minimum probability the model must give the chosen side for the bot
 * to take a trade. Two reasons we set this above 0.5:
 *
 *   1. Calibration. The long-shot tail of the surface is empirically
 *      under-calibrated (the 2026-05-04 session showed 0.15–0.30 buckets
 *      realizing 5%–14% vs predicted ~18%–27%; 0.30–0.40 was well
 *      calibrated at 31% actual / 33% predicted). The gate prunes the
 *      tail where we can't trust the model.
 *
 *   2. Variance. With $20 stakes and ~100 trades/day, betting at 0.30
 *      conviction means losing 70% of the time — even when +EV by
 *      edge, individual losses dominate session PnL. Lifting to 0.55
 *      means the chosen side wins more often than not, smoothing PnL
 *      and bounding drawdown.
 *
 * Worth A/B testing 0.55 vs 0.60 vs 0.65 on captured data — higher
 * thresholds reduce trade count meaningfully and the optimal balance
 * between throughput and per-trade reliability isn't obvious.
 *
 * Note: This is in addition to MIN_EDGE. A trade must clear BOTH
 * thresholds.
 */
export const MIN_MODEL_PROBABILITY = 0.55;

/**
 * Minimum queue depth (in shares resting at our chosen-side limit
 * price) required for the dry-run runner to actually place. Orders
 * placed against a thin bid queue are over-represented in adverse
 * fills: in the 2026-05-05 dry-run session at 84 orders, the bottom
 * 42% by queue depth (queueAheadShares < 20) bled the entire run's
 * canonical PnL — dropping them flipped canonical PnL from -$228 to
 * +$129 ($357 swing) while raising filled win rate from 31% to 42%.
 * A thin queue means our level isn't being defended by other resting
 * bids; fills concentrate on price-level breaks and we get hit on the
 * way down (the textbook adverse-fill pattern).
 *
 * The gate is checked AFTER the model-side `evaluateDecision` returns
 * `trade`; it does not change which side the bot picks, only whether
 * placement actually proceeds.
 *
 * Counterfactual on the 2026-05-05 iter 3 mid-run (84 orders, modelP
 * gate already applied):
 * - Filled win rate: 31% → 42%
 * - All-orders win rate: 38% → 47%
 * - Canonical PnL: -$228 → +$129 (positive flip)
 * - All-orders PnL: +$3 → +$219
 *
 * Threshold history: iter 3 used 7 (too soft, fired only 26 times in
 * 3hrs and was effectively a no-op); analysis on the larger sample
 * showed the cleaner cut is at 20.
 */
export const MIN_QUEUE_AHEAD_SHARES = 20;

/**
 * Number of completed 5-minute closes the live runner pulls at startup
 * to bootstrap every tracker the regime classifier consumes (EMA-20,
 * EMA-50, ATR-14, ATR-50). The slowest seed needs 50 bars; we pull a
 * comfortable margin so a single missed bar over the wire doesn't
 * stall the seed.
 */
export const REGIME_TRACKER_BOOTSTRAP_BARS = 70;

/**
 * Fixed USD stake per trade. Hardcoded on purpose: this is part of the
 * trading strategy, not an operational knob. Bumping this number is a
 * code change and a reviewable diff.
 */
export const STAKE_USD = 20;

/**
 * Polymarket maker fee rate as a fraction (1.0 = 100%). Applied as
 * `cost * MAKER_FEE_RATE` in PnL accounting. Polymarket's standard
 * crypto up/down markets currently charge 0% maker fees — we wire the
 * constant through anyway so the formula is correct if the venue ever
 * starts charging.
 *
 * Taker fees can be up to 7% on these markets, which is why we are
 * exclusively maker. See the order placement code for the constraint.
 */
export const MAKER_FEE_RATE = 0;

/**
 * Margin (in milliseconds) before the 5m window close at which the
 * runner cancels any still-resting limit orders. Cancelling slightly
 * early avoids racing the venue's own market-close cleanup and keeps
 * our in-memory state in sync with the truth on Polymarket.
 */
export const ORDER_CANCEL_MARGIN_MS = 10_000;

/**
 * Margin (in milliseconds) after the 5m window close at which the
 * runner emits the window summary. We give Polymarket a few seconds
 * to settle the market and the user WS channel a few seconds to
 * deliver any final fill notifications, so the summary line is
 * already accurate when it ships to Telegram.
 */
export const WINDOW_SUMMARY_DELAY_MS = 8_000;

/**
 * The settlement payout for a winning YES token, expressed in USDC.
 * Hardcoded here so the PnL math has a named reference point —
 * Polymarket has always paid $1 per winning YES, but the constant
 * makes that assumption visible in diffs.
 */
export const WINNING_YES_PAYOUT_USD = 1;

// ----------------------------------------------------------------
// Regime-algo promotion + live registry
// ----------------------------------------------------------------

/**
 * Live regime algos. Identical to the full registry: the live
 * decision path computes a complete `RegimeClassifierInput` from the
 * per-asset rolling bars buffer (same code path the training-side
 * snapshot pipeline runs over historical candles), so every algo can
 * read whatever features its `classify` needs without per-input
 * wiring. The probability-table generator filters this set further
 * by leading-regime threshold — only algos with at least one regime
 * clearing `LEADING_REGIME_MIN_LEAD_PP` end up in the persisted live
 * table.
 *
 * Adding a new algo: append it to the registry. It auto-joins live
 * trading at the next gen-table run if any of its regimes lead.
 */
export const LIVE_TRADING_REGIME_ALGOS: readonly RegimeAlgo[] = regimeAlgos;

/**
 * Minimum average pp-lead vs the unconditional baseline for a regime
 * to be treated as "leading" — i.e. persisted into the probability
 * table and consulted at decision time. 1.0pp because:
 *
 *   - Below ~0.5pp is plausibly noise on the bucket-rate estimates;
 *   - 1.0pp is meaningfully above per-cell binomial SE at our sample
 *     floor;
 *   - Higher (e.g. 2pp) would prune most of the trend × vol buckets.
 *
 * Tunable. Worth A/B'ing 0.5 / 1.0 / 1.5 if early live results
 * suggest we're including too many marginal regimes.
 */
export const LEADING_REGIME_MIN_LEAD_PP = 1.0;

/**
 * Single shared sample-count floor for every per-cell rate the regime
 * path consumes — chart visibility, dashboard avgLeadPp aggregation,
 * gen-table leading-regime determination, summary stats. One constant
 * so the dashboard, the gen-time filter, and the persisted live table
 * all agree on which cells are trustworthy.
 *
 * 400 trades a slightly looser per-cell SE (~2.5pp on a 50/50 base
 * rate) for much wider bp coverage on tail regimes (vol_only_3
 * low/high, vol_quartiles_4 q1/q4, etc.).
 *
 * Independent from the legacy filter framework's
 * `SWEET_SPOT_MIN_SAMPLES` (2,000); that one only gates the
 * deprecated binary-filter analysis under the dashboard's "Legacy
 * filters" collapsible.
 */
export const REGIME_CELL_MIN_SAMPLES = 400;
