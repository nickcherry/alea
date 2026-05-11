import type { Asset } from "@alea/types/assets";
import type { CandleTimeframe } from "@alea/types/candles";
import type { z } from "zod";

/**
 * A single closed bar passed to filter `predict`. We don't pass the
 * full `Candle` shape (which carries source/product/asset metadata
 * the filter doesn't need) so this stays purely about the OHLCV
 * vector. Filters NEVER see the next bar's open or close — only
 * fully-closed bars before the prediction moment.
 */
export type FilterBar = {
  readonly openTimeMs: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
};

/**
 * What a filter returns for one decision moment.
 *
 * - `"up"` / `"down"`: the filter has fired and predicts the next
 *   bar will close above / below its open.
 * - `null`: abstain. The filter has no opinion at this moment. Not
 *   the same as "predicts no change" — it means the filter's
 *   trigger conditions weren't met. Abstains are not recorded in
 *   the `fires` blob and don't affect the win rate denominator.
 */
export type FilterPrediction = "up" | "down" | null;

/**
 * Strategy regime a filter belongs to. Used to group cards on the
 * exploration dashboard and to drive committee-construction logic
 * later: when picking diversified peers, prefer one filter from each
 * regime over multiple filters from the same one.
 *
 * Buckets reflect WHAT the filter is testing for, not "is the market
 * currently trending or choppy". Choosing six rather than three keeps
 * neighbouring families (e.g. band-position vs. oscillator-extreme)
 * separated even though both are mean-reversion ideas:
 *
 *   - `band_reversion`        — vol-scaled band pierces (Bollinger,
 *                               Keltner, z-score, %B, recovery, HA)
 *   - `oscillator_reversion`  — oscillator-extreme reads (RSI, Stoch,
 *                               CCI, Stoch-RSI, Aroon)
 *   - `velocity_fade`         — fade a recent move (ATR-burst,
 *                               multi-bar return, RSI velocity, range
 *                               expansion, streak fade)
 *   - `ma_position`           — close vs. a moving-average baseline
 *                               (SMA / EMA position)
 *   - `pattern`               — single- or multi-bar candle shape
 *                               (pin bar, engulfing)
 *   - `divergence`            — indicator/price disagreement
 *                               (RSI divergence)
 */
export type Regime =
  | "band_reversion"
  | "oscillator_reversion"
  | "velocity_fade"
  | "ma_position"
  | "pattern"
  | "divergence";

/**
 * One concrete filter implementation. The framework guarantees:
 *
 *   1. `predict` is called with `bars` ordered ascending by
 *      `openTimeMs` and exactly `requiredBars(config)` entries long.
 *      The most recent CLOSED bar is `bars[bars.length - 1]`. The
 *      "prediction target" — the bar that just opened, whose
 *      `open` ≈ `bars[bars.length - 1].close` — is NOT in the array.
 *   2. `version` increments invalidate any cached results for this
 *      filter. Bump it whenever the body of `predict` changes the
 *      output for the same inputs (or the indicator math
 *      underneath does).
 *   3. `configSchema.parse(config)` is the only way the framework
 *      hands the filter a config. Defaults declared in the schema
 *      apply when a candidate registers with a partial config.
 *   4. `id` is the stable, snake_case identifier persisted on every
 *      filter_runs row. Renaming an id is equivalent to deleting
 *      the filter and adding a new one.
 *
 * `description` is for the dashboard tooltip — one or two sentences,
 * lay-readable but technically faithful (e.g. "Fires UP when RSI is
 * oversold (≤ `low`) and DOWN when overbought (≥ `high`); otherwise
 * abstains. Classic two-sided mean-reversion rule.").
 */
export type Filter<TConfig> = {
  readonly id: string;
  readonly version: number;
  readonly description: string;
  readonly regime: Regime;
  readonly configSchema: z.ZodType<TConfig>;
  readonly requiredBars: (config: TConfig) => number;
  readonly predict: (
    config: TConfig,
    bars: readonly FilterBar[],
  ) => FilterPrediction;
};

/**
 * A configured filter, ready to backtest. `config` is the
 * already-validated config object the filter's schema would have
 * produced; the candidate's `hash` is deterministic over
 * `(filterId, version, configCanon)` and is used as the cache key
 * primary axis (joined with `period` and `asset` to form the
 * `run_hash`).
 *
 * `configCanon` is the canonical JSON stringification of `config`
 * — the same string used to compute the hash. Stored on the
 * `filter_runs` row alongside the parsed `config` so a future
 * lookup can verify a row's hash matches its stored config without
 * re-running schema validation.
 */
export type Candidate = {
  readonly filterId: string;
  readonly version: number;
  readonly config: unknown;
  readonly configCanon: string;
  readonly candidateHash: string;
};

/**
 * `(candidate, period, asset)` — the cache unit a `filter_runs` row
 * represents. Same candidate evaluated on 5m vs 15m candles gets
 * different rows.
 */
export type RunIdentity = {
  readonly candidate: Candidate;
  readonly period: CandleTimeframe;
  readonly asset: Asset;
  readonly runHash: string;
};
