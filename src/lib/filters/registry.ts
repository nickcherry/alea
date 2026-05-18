import type { TradeDecisionPeriod } from "@alea/constants/tradeDecision";
import type { FilterCandidate } from "@alea/lib/filters/types";
import type { Asset } from "@alea/types/assets";

export type CandidateRegistryByPeriod = Readonly<
  Record<TradeDecisionPeriod, readonly FilterCandidate[]>
>;

export type CandidateRegistryByMarket = Readonly<
  Record<
    TradeDecisionPeriod,
    Readonly<Partial<Record<Asset, readonly FilterCandidate[]>>>
  >
>;

const EMPTY: readonly FilterCandidate[] = [];

/**
 * No candidates are currently registered. The old filter family was
 * built for the synth-bar/predict-next-candle model; under the new
 * take-profit-within-N-candles model with no synth, filters need to
 * be re-derived from scratch. Register new candidates here when ready.
 */
export const registeredCandidatesByMarket = {
  "1h": {
    btc: EMPTY,
    eth: EMPTY,
    sol: EMPTY,
    xrp: EMPTY,
    doge: EMPTY,
  },
} as const satisfies CandidateRegistryByMarket;

export const tradeCandidatesByMarket = registeredCandidatesByMarket;

export const registeredCandidatesByPeriod = {
  "1h": EMPTY,
} as const satisfies CandidateRegistryByPeriod;

export const registeredCandidates: readonly FilterCandidate[] = EMPTY;

export function registeredCandidatesForMarket({
  period,
  asset,
}: {
  readonly period: TradeDecisionPeriod;
  readonly asset: Asset;
}): readonly FilterCandidate[] {
  return registeredCandidatesByMarket[period][asset] ?? EMPTY;
}

export function tradeCandidatesForMarket({
  period,
  asset,
}: {
  readonly period: TradeDecisionPeriod;
  readonly asset: Asset;
}): readonly FilterCandidate[] {
  return tradeCandidatesByMarket[period][asset] ?? EMPTY;
}

export function registeredCandidatesForPeriod({
  period,
}: {
  readonly period: TradeDecisionPeriod;
}): readonly FilterCandidate[] {
  return registeredCandidatesByPeriod[period];
}
