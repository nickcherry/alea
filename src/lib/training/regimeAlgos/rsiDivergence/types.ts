/**
 * The five mutually-exclusive RSI-divergence states one bar can be
 * tagged with after the lookback rule applies. The labels are stable,
 * snake_case identifiers — they're persisted on every probability-table
 * entry and a rename invalidates the table silently. Same convention as
 * `RegimeLabel` elsewhere in this directory.
 *
 * - `bull_div`        — REGULAR bullish: price prints a lower-low
 *                       while RSI prints a higher-low. Classic
 *                       reversal-up signal.
 * - `hidden_bull_div` — HIDDEN bullish: price prints a higher-low
 *                       while RSI prints a lower-low. Read as an
 *                       uptrend-continuation signal.
 * - `bear_div`        — REGULAR bearish: price prints a higher-high
 *                       while RSI prints a lower-high. Reversal-down.
 * - `hidden_bear_div` — HIDDEN bearish: price prints a lower-high
 *                       while RSI prints a higher-high. Downtrend
 *                       continuation.
 * - `no_div`          — None of the above is active in the
 *                       lookback window.
 */
export type RsiDivergenceLabel =
  | "bull_div"
  | "hidden_bull_div"
  | "bear_div"
  | "hidden_bear_div"
  | "no_div";

export const RSI_DIVERGENCE_LABELS: readonly RsiDivergenceLabel[] = [
  "bull_div",
  "hidden_bull_div",
  "bear_div",
  "hidden_bear_div",
  "no_div",
];

/**
 * Which of the four divergence patterns (if any) fired AT a given bar.
 * Multiple flags can be set on the same bar in pathological cases —
 * e.g., the same pivot index counts as both a low and a high in a
 * synthetic series — but in practice typically zero or one fires.
 *
 * `flagged` is true whenever any of the four is true; convenient for
 * the lookback walk in `labelAt`.
 */
export type BarDivergenceFlags = {
  readonly regBull: boolean;
  readonly hidBull: boolean;
  readonly regBear: boolean;
  readonly hidBear: boolean;
  readonly flagged: boolean;
};

export const NO_DIVERGENCE_FLAGS: BarDivergenceFlags = {
  regBull: false,
  hidBull: false,
  regBear: false,
  hidBear: false,
  flagged: false,
};

/**
 * Configuration knobs for a single divergence-detection run. Defaults
 * mirror the Pine Script the trader was studying:
 *   `RSI Period=14`, `Pivot Lookback Right=5`, `Pivot Lookback Left=5`,
 *   `Min Range=5`, `Max Range=60`. The `lookbackBars` knob is our
 *   addition (Pine Script just plots whenever a divergence triggers;
 *   we want a per-bar label so the regime classifier can read it as a
 *   scalar at decision time).
 */
export type RsiDivergenceConfig = {
  readonly rsiLength: number;
  readonly lbL: number;
  readonly lbR: number;
  readonly rangeLower: number;
  readonly rangeUpper: number;
  readonly lookbackBars: number;
};
