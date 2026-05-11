/**
 * Market regime tags computed at decision time. The committee
 * fires for every candidate regardless of regime; we record the
 * regime so we can later analyse hit-rate by market state and,
 * eventually, scope the committee to candidates that historically
 * win in that regime.
 *
 * The classification is a 2×2:
 *   - volatility:   low | high   (recent realised vol vs longer-window baseline)
 *   - directionality: trending | ranging (linreg slope significance vs noise)
 *
 * "Mixed" / unclassifiable bars (insufficient history) get `null`.
 */
export type MarketRegime =
  | "low_vol_trending"
  | "low_vol_ranging"
  | "high_vol_trending"
  | "high_vol_ranging";
