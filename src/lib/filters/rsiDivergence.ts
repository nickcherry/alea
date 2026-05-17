import {
  findRecentRsiDivergenceMatch,
  type RsiDivergenceBaseConfig,
} from "@alea/lib/filters/rsiDivergenceCore";
import {
  applyRsiDivergenceInvalidation,
  type RsiDivergenceInvalidationConfig,
} from "@alea/lib/filters/rsiDivergenceInvalidation";
import {
  pythSpotCandleSource,
  type TradingFilter,
} from "@alea/lib/filters/types";

export type RsiDivergenceConfig = RsiDivergenceBaseConfig &
  RsiDivergenceInvalidationConfig;

export { selectRecentRsiDivergenceSignal } from "@alea/lib/filters/rsiDivergenceCore";

export const rsiDivergenceFilter: TradingFilter<RsiDivergenceConfig> = {
  id: "rsi_divergence",
  name: "RSI Divergence",
  version: 6,
  description:
    "Matches TradingView's RSI Divergence indicator: compute Wilder RSI on close, confirm RSI pivot highs and lows with left/right lookbacks, then compare the immediately previous RSI pivot inside the configured range. Bullish divergences vote up and bearish divergences vote down when the confirmation is inside the configured recency window; hidden divergences can be included through config. After confirmation, each candle that agrees with the signal adds one point and each candle that disagrees subtracts one point; the signal goes neutral if that tally falls below the configured minimum or the configured disagreeing-candle streak is reached.",
  sources: [pythSpotCandleSource],
  evaluate({ series, config }) {
    const match = findRecentRsiDivergenceMatch({ series, config });
    return applyRsiDivergenceInvalidation({ match, config });
  },
};
