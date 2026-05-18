import type { TradeDecisionPeriod } from "@alea/constants/tradeDecision";
import type { MarketBar } from "@alea/lib/marketSeries/types";
import type { Asset } from "@alea/types/assets";
import type { Product } from "@alea/types/products";
import type { CandleSource } from "@alea/types/sources";

export const filterDecisionValues = ["up", "down", "neutral"] as const;

export type FilterDecision = (typeof filterDecisionValues)[number];

export type FilterConfig = Readonly<Record<string, unknown>>;

export type FilterSourceRole = "primary-candles" | "volume-context";

export type FilterSourceSpec = {
  readonly source: CandleSource;
  readonly product: Product;
  readonly role: FilterSourceRole;
};

export const pythSpotCandleSource = {
  source: "pyth",
  product: "spot",
  role: "primary-candles",
} as const satisfies FilterSourceSpec;

/**
 * Bars supplied to a filter at decision time. These are *all closed*
 * 1h candles ending at the bar that just closed before the entry
 * candle opens. The filter never sees the entry candle itself.
 *
 * `crossAssetBars` is keyed by asset and contains the same shape of
 * closed-bar series for every other tradable asset, useful for broad
 * market confluence checks. The current asset's bars are also
 * available at `crossAssetBars[context.asset]`.
 */
export type CrossAssetBars = Readonly<
  Partial<Record<Asset, readonly MarketBar[]>>
>;

export type FilterEvaluationContext = {
  readonly asset: Asset;
  readonly period: TradeDecisionPeriod;
  readonly targetTsMs: number;
  readonly bars: readonly MarketBar[];
  readonly crossAssetBars?: CrossAssetBars;
};

export type FilterEvaluation = {
  readonly decision: FilterDecision;
  readonly reason?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
};

export type TradingFilter<Config extends FilterConfig = FilterConfig> = {
  readonly id: string;
  readonly name: string;
  readonly version: number;
  readonly description: string;
  readonly sources: readonly FilterSourceSpec[];
  readonly evaluate: (
    params: FilterEvaluationContext & { readonly config: Config },
  ) => FilterEvaluation;
};

export type FilterCandidate<Config extends FilterConfig = FilterConfig> = {
  readonly id: string;
  readonly filterId: string;
  readonly filterName: string;
  readonly filterVersion: number;
  readonly description: string;
  readonly sources: readonly FilterSourceSpec[];
  readonly config: Config;
  readonly configCanon: string;
  readonly configHash: string;
  /**
   * Trade execution profile attached to this candidate. The signal
   * (filter + config) decides direction; these decide what counts as
   * a win or loss for that decision. Both are fractions of entry
   * price — e.g. 0.03 = 3%.
   */
  readonly takeProfitPct: number;
  readonly stopLossPct: number;
  readonly evaluate: (context: FilterEvaluationContext) => FilterEvaluation;
};

export type CandidateVote = {
  readonly candidateId: string;
  readonly filterId: string;
  readonly filterName: string;
  readonly filterVersion: number;
  readonly configHash: string;
  readonly decision: FilterDecision;
  readonly reason: string | null;
};

export type CandidateTradeDecision = {
  readonly decision: "up" | "down" | "neutral";
  readonly prediction: "u" | "d" | null;
  readonly up: number;
  readonly down: number;
  readonly neutral: number;
  readonly votes: readonly CandidateVote[];
  readonly summary: string;
};
