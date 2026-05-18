import type { TradeDecisionPeriod } from "@alea/constants/tradeDecision";
import { defineCandidate } from "@alea/lib/filters/config";
import {
  type RsiDivergenceConfig,
  rsiDivergenceFilter,
} from "@alea/lib/filters/rsiDivergence";
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

const oneHourRsiDivergenceCandidate = defineCandidate({
  filter: rsiDivergenceFilter,
  config: {
    rsiLength: 21,
    includeHidden: true,
    leftBars: 2,
    rightBars: 2,
    rangeLower: 2,
    rangeUpper: 30,
    maxSignalAgeBars: 13,
  } satisfies RsiDivergenceConfig,
  takeProfitPct: 0.03,
  stopLossPct: 0.02,
});

const baseCandidates = [oneHourRsiDivergenceCandidate];

export const registeredCandidatesByMarket = {
  "1h": {
    btc: baseCandidates,
    eth: baseCandidates,
    sol: baseCandidates,
    xrp: baseCandidates,
    doge: baseCandidates,
  },
} as const satisfies CandidateRegistryByMarket;

export const tradeCandidatesByMarket = registeredCandidatesByMarket;

export const registeredCandidatesByPeriod = {
  "1h": baseCandidates,
} as const satisfies CandidateRegistryByPeriod;

export const registeredCandidates: readonly FilterCandidate[] = baseCandidates;

export function registeredCandidatesForMarket({
  period,
  asset,
}: {
  readonly period: TradeDecisionPeriod;
  readonly asset: Asset;
}): readonly FilterCandidate[] {
  return registeredCandidatesByMarket[period][asset] ?? [];
}

export function tradeCandidatesForMarket({
  period,
  asset,
}: {
  readonly period: TradeDecisionPeriod;
  readonly asset: Asset;
}): readonly FilterCandidate[] {
  return tradeCandidatesByMarket[period][asset] ?? [];
}

export function registeredCandidatesForPeriod({
  period,
}: {
  readonly period: TradeDecisionPeriod;
}): readonly FilterCandidate[] {
  return registeredCandidatesByPeriod[period];
}
