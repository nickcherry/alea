/**
 * Import this file once at any entry point (CLI, backtest) to
 * populate the filter registry with every implementation under
 * `filters/`. Each file's top-level `registerFilter` call runs as a
 * side effect of being imported.
 *
 * Adding a new filter: one import line here + the corresponding
 * file under `filters/`.
 *
 * Filter history: the May 2026 seed set included six filters
 * (bollinger_reversion, ema_cross, macd_signal, prior_bar_carry,
 * rsi_meanrev, sma_cross). After running them across 3y of
 * pyth/spot candles, the four trend-following variants all settled
 * below 50% aggregate win rate on both 5m and 15m bars and were
 * removed. Only mean-reversion ideas survive in the live registry.
 */
/**
 * Each registered filter tests a SINGLE hypothesis on a single
 * indicator / pattern. Combination filters — confluence of two
 * different families (e.g. a Bollinger pierce AND an RSI extreme)
 * — were deliberately removed: the trade committee, not the
 * filter registry, is responsible for assembling confluence across
 * independent signals.
 */
import "@alea/lib/filters/aroonReversion";
import "@alea/lib/filters/atrBurstFade";
import "@alea/lib/filters/bollingerPercentB";
import "@alea/lib/filters/bollingerRecovery";
import "@alea/lib/filters/bollingerReversion";
import "@alea/lib/filters/cciMeanRev";
import "@alea/lib/filters/cmoMeanRev";
import "@alea/lib/filters/demaBollingerReversion";
import "@alea/lib/filters/disparityIndexReversion";
import "@alea/lib/filters/donchianReversion";
import "@alea/lib/filters/emaPosition";
import "@alea/lib/filters/engulfingReversal";
import "@alea/lib/filters/heikinAshiReversion";
import "@alea/lib/filters/hullMaPosition";
import "@alea/lib/filters/keltnerReversion";
import "@alea/lib/filters/linearRegressionSlopeFade";
import "@alea/lib/filters/madReversion";
import "@alea/lib/filters/multiBarReturnFade";
import "@alea/lib/filters/percentRankMeanRev";
import "@alea/lib/filters/pinBarReversal";
import "@alea/lib/filters/rangeExpansionFade";
import "@alea/lib/filters/rsiDivergence";
import "@alea/lib/filters/rsiMeanRev";
import "@alea/lib/filters/rsiVelocity";
import "@alea/lib/filters/smaPosition";
import "@alea/lib/filters/stdevChannelReversion";
import "@alea/lib/filters/stochRsiMeanRev";
import "@alea/lib/filters/stochasticMeanRev";
import "@alea/lib/filters/streakFade";
import "@alea/lib/filters/tsiMeanRev";
import "@alea/lib/filters/volatilityBurstFade";
import "@alea/lib/filters/williamsRMeanRev";
import "@alea/lib/filters/zscoreReversion";
