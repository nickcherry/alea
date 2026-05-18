import type { TradeDecisionPeriod } from "@alea/constants/tradeDecision";
import type { AlignedMarketSeries } from "@alea/lib/marketSeries/types";
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
 * Per-asset market series at decision time, keyed by asset. Used by filters
 * that need to consult OTHER assets' bars (e.g. broad-market confluence
 * gating). The current asset's series is also present at
 * `crossAssetSeries[context.asset]`.
 *
 * Populated by the harness (backtest, dry-run, live-trading) where
 * available; filters that don't need cross-asset state simply ignore it.
 * Filters that DO need it must handle the `undefined`/missing-asset case
 * gracefully — typically by failing closed (no trigger) when the harness
 * cannot provide the data.
 */
export type CrossAssetSeries = Readonly<
  Partial<Record<Asset, AlignedMarketSeries>>
>;

export type FilterEvaluationContext = {
  readonly asset: Asset;
  readonly period: TradeDecisionPeriod;
  readonly targetTsMs: number;
  readonly series: AlignedMarketSeries;
  readonly crossAssetSeries?: CrossAssetSeries;
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
