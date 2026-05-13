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
 * Where a filter's input bars come from. Required on every filter so
 * the framework can route the right candle stream automatically.
 *
 *  - `"pyth"`: Pyth Network oracle median bars. OHLC matches the
 *    Polymarket-aligned settlement proxy. `volume` on these bars is
 *    always `0` (Pyth is an oracle median, not a venue tape) — so
 *    filters that read `volume` must NOT declare `"pyth"`.
 *  - `"coinbase"`: Coinbase spot OHLCV from the Advanced Trade API.
 *    Carries real exchange volume. Use this for any filter that
 *    reads `volume` (MFI, VWAP, OBV, relative-volume gates, etc.).
 *
 * The runtime always pre-loads BOTH streams, aligned by openTimeMs,
 * and slices the right one per filter at call time. Outcome
 * labeling for training continues to use Pyth bars regardless of the
 * filter's input source — Pyth is the single source of truth for
 * "what direction did the next bar close".
 */
export type BarSource = "pyth" | "coinbase";

/**
 * What a filter returns for one decision moment.
 *
 * - `"up"` / `"down"`: the filter has engaged and predicts the next
 *   bar will close above / below its open.
 * - `null`: abstain. The filter has no opinion at this moment. Not
 *   the same as "predicts no change" — it means the filter's
 *   engagement conditions weren't met. Abstains are not recorded in
 *   `filter_engagements` and don't affect the win rate denominator.
 */
export type FilterPrediction = "up" | "down" | null;

/**
 * Strategy family a filter belongs to. Used to group cards on the
 * exploration dashboard and to drive committee-construction logic
 * later: when picking diversified peers, prefer one filter from each
 * family over multiple filters from the same one.
 *
 * Buckets reflect WHAT the filter is testing for, not "is the market
 * currently trending or choppy". The original seed set used six broad
 * buckets; later research adds narrower categories for volume,
 * structure, continuation, and body-sequence hypotheses so the
 * dashboard can separate genuinely different measurement bases:
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
 *   - `structure_reversion`   — failed/swept breakout structure
 *   - `compression_continuation` — continuation after narrow/inside bars
 *   - `volatility_compression_continuation` — squeeze breakouts
 *   - `trend_quality` / `trend_continuation` / `trend_flip_continuation`
 *                               — directional trend-following signals
 *   - pullback, persistence, swing-structure, and body-sign families
 *                               — OHLC-only continuation/failure probes
 *   - volume/body/sequence families — orthogonal volume participation
 *                               and candle-body direction tests
 */
export type FilterFamily =
  | "band_reversion"
  | "oscillator_reversion"
  | "velocity_fade"
  | "ma_position"
  | "pattern"
  | "divergence"
  | "structure_reversion"
  | "compression_continuation"
  | "compression_failure"
  | "volatility_compression_continuation"
  | "candle_momentum_continuation"
  | "candle_location_reversion"
  | "candle_exhaustion"
  | "micro_structure_continuation"
  | "swing_structure_continuation"
  | "swing_structure_reversion"
  | "trend_quality"
  | "range_reversion"
  | "trend_continuation"
  | "trend_exhaustion"
  | "trend_flip_continuation"
  | "trend_pullback_continuation"
  | "persistence_continuation"
  | "body_sign_regime"
  | "momentum_cross_continuation"
  | "momentum_exhaustion"
  | "oscillator_reversal"
  | "volume_weighted_reversion"
  | "volume_weighted_acceptance"
  | "volume_oscillator_reversion"
  | "volume_divergence"
  | "volume_divergence_reversion"
  | "volume_exhaustion"
  | "volume_momentum_continuation"
  | "volume_absorption_reversion"
  | "volume_absorption_failure"
  | "volume_flow_continuation"
  | "volume_acceleration_continuation"
  | "volume_dormancy_expansion"
  | "volume_profile_reversion"
  | "volume_profile_air_pocket"
  | "signed_flow_exhaustion"
  | "signed_flow_divergence"
  | "empirical_volume_sequence"
  | "participation_failure"
  | "participation_continuation"
  | "body_momentum_reversion"
  | "body_location_oscillator"
  | "directional_sequence_reversion"
  | "directional_sequence_pattern";

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
 * lay-readable but technically faithful (e.g. "Engages UP when RSI is
 * oversold (≤ `low`) and DOWN when overbought (≥ `high`); otherwise
 * abstains. Classic two-sided mean-reversion rule.").
 */
export type Filter<TConfig> = {
  readonly id: string;
  readonly version: number;
  readonly description: string;
  readonly family: FilterFamily;
  /**
   * Which candle stream this filter's `predict` consumes. Required
   * with no default: a filter that reads `volume` must declare
   * `"coinbase"`, since Pyth bars always carry `volume: 0`. The
   * pipeline routes per filter, so a committee can mix price-only
   * and volume filters on the same decision moment.
   */
  readonly barSource: BarSource;
  readonly configSchema: z.ZodType<TConfig>;
  readonly requiredBars: (config: TConfig) => number;
  readonly predict: (
    config: TConfig,
    bars: readonly FilterBar[],
  ) => FilterPrediction;
};

/**
 * A configured filter, ready for training or committee replay. `config` is the
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
