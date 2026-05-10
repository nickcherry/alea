import type { RsiDivergenceLabel } from "@alea/lib/training/regimeAlgos/rsiDivergence/types";
import type { LeadingSide } from "@alea/lib/trading/types";

/**
 * Stable, machine-readable label for one regime bucket. Algo-specific:
 * each `RegimeAlgo` declares its own label set in `regimes`. Used as a
 * key into the per-regime probability surface map and as a tab/badge
 * label in the dashboard.
 *
 * Convention: snake_case, no spaces, descriptive. Examples:
 * `"no_trend_low_vol"`, `"with_trend_high_vol"`. Don't change a label
 * after it's in production — the persisted probability table keys off it
 * and a rename invalidates the table silently.
 */
export type RegimeLabel = string;

/**
 * Inputs the regime classifier needs at decision time AND at training
 * time. Same shape so the live `evaluateDecision` and the offline
 * `computeAssetProbabilities` both call the algo with identical
 * arguments and can never silently desync.
 *
 * Fields are nullable so the algo decides for itself whether missing
 * context counts as "skip" (return `null`) or as a default bucket.
 * Today every algo treats missing context as skip.
 */
export type RegimeClassifierInput = {
  /**
   * Side currently in the lead within the active 5m window: `"up"` if
   * `price >= line`, else `"down"`. The regime label is computed
   * relative to this — "with-trend" means the leading side is aligned
   * with the trend direction.
   */
  readonly leadingSide: LeadingSide;
  /**
   * EMA-20 of 5m closes, evaluated through and including the most
   * recent COMPLETED 5m bar. `null` until the EMA-20 series has seeded.
   */
  readonly ema20: number | null;
  /** EMA-50 of 5m closes; same semantics as `ema20`. */
  readonly ema50: number | null;
  /**
   * Wilder ATR-14 of 5m bars, through and including the most recent
   * COMPLETED 5m bar. Used as the "current-vol" reference. `null` until
   * the series has seeded.
   */
  readonly atr14: number | null;
  /**
   * Wilder ATR-50 of 5m bars; longer-window vol baseline used as the
   * denominator in the vol-regime ratio.
   */
  readonly atr50: number | null;
  /**
   * 14-period RSI on 5m closes (Wilder smoothing). Range 0–100, with
   * 50 the neutral midpoint. Used by momentum-extreme regime algos.
   * `null` until the series has seeded OR when the live decision path
   * doesn't track RSI (the live runner currently passes `null` here;
   * an RSI-based algo can't be `LIVE_TRADING_REGIME_ALGO` until we wire
   * the live RSI tracker).
   */
  readonly rsi14: number | null;
  /**
   * 3-period Wilder ATR on 5m bars — a faster vol signal than ATR-14.
   * Useful as a numerator for vol-ratio regimes that should respond
   * to recent shocks more quickly. `null` at decision time when the
   * live runner doesn't track ATR-3.
   */
  readonly atr3: number | null;
  /**
   * Direction of the most recent COMPLETED 5m bar (UP if close ≥
   * open, else DOWN). Used by carry-based regime algos that ask
   * "does the leading side align with the previous bar's direction?"
   * `null` when no prior bar is present, or at decision time when the
   * live runner doesn't track previous-bar direction.
   */
  readonly prev5mDirection: "up" | "down" | null;

  /**
   * RSI-divergence state on the 5m / 15m candle series, evaluated
   * with three different "active within last N bars" lookbacks.
   * Same semantics as the matching fields on
   * `SurvivalSnapshotContext`. `null` until the underlying series
   * has accumulated enough history for any pivot pair to clear
   * `rangeLower`, OR at decision time when the live runner doesn't
   * compute divergence (the live regime tracker doesn't carry the
   * full RSI history yet — same warmup story `rsi14`/`atr3` already
   * follow). An algo that needs a divergence field returns `null`
   * from `classify` whenever the corresponding input is `null`.
   */
  readonly rsiDivergence5mW3: RsiDivergenceLabel | null;
  readonly rsiDivergence5mW5: RsiDivergenceLabel | null;
  readonly rsiDivergence5mW7: RsiDivergenceLabel | null;
  readonly rsiDivergence15mW3: RsiDivergenceLabel | null;
  readonly rsiDivergence15mW5: RsiDivergenceLabel | null;
  readonly rsiDivergence15mW7: RsiDivergenceLabel | null;
};

/**
 * One regime classification algorithm. Pure function from
 * `RegimeClassifierInput` → `RegimeLabel | null`, plus metadata used by
 * the dashboard to render comparison sections and by the probability-
 * table generator to auto-promote algos with leading regimes to live.
 *
 * Adding a new algo: one file under `regimeAlgos/` exporting an object
 * that satisfies this type, plus a single line in the registry. The
 * live decision path computes the full `RegimeClassifierInput` from a
 * rolling 5m bar buffer, so every input the lookback can compute is
 * automatically available — no per-algo wiring. If any of the algo's
 * regimes lead the baseline by ≥ the configured threshold, it
 * auto-joins live trading at the next gen-table run.
 */
export type RegimeAlgo = {
  /**
   * Stable, machine-readable identifier (snake_case, no spaces). Used
   * as the cache filename component, the dashboard JSON payload field
   * key, and the algoId persisted on each prob-table entry. Don't
   * change it after an algo is in production.
   */
  readonly id: string;

  /** Human-readable section title for the dashboard. */
  readonly displayName: string;

  /**
   * One-or-two-sentence prose explanation of the partitioning. Same
   * style guide as `SurvivalFilter.description` — phrase as a question,
   * write for non-quants, mention the precise threshold in parens.
   */
  readonly description: string;

  /**
   * Bumps when `classify` produces materially different output for the
   * same input — different threshold, different formula, a corrected
   * bug. Cache keys mix this in so a version bump invalidates only this
   * algo's cached results, not the whole dashboard.
   */
  readonly version: number;

  /**
   * Ordered list of every regime label this algo can emit. The
   * dashboard renders columns in this order; the probability-table
   * generator allocates one surface per label. Must be exhaustive —
   * `classify` may never return a label not in this list.
   */
  readonly regimes: readonly RegimeLabel[];

  /**
   * Pure classifier. Returns `null` when the inputs the algo needs
   * aren't all present (warmup, degenerate ATR, etc.) — caller decides
   * whether to skip or treat the snapshot as unclassified.
   */
  readonly classify: (input: RegimeClassifierInput) => RegimeLabel | null;

  /**
   * Free-form parameter snapshot for display/diagnostics. The dashboard
   * renders these as "param: value" pairs under the section title so an
   * operator can read the algo's thresholds at a glance.
   */
  readonly params: Readonly<Record<string, number>>;
};
