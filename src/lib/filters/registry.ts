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

const registryAssets = [
  "btc",
  "eth",
  "sol",
  "doge",
] as const satisfies readonly Asset[];

const rsiDivergenceMinAgreementScores = [0, -1, -2, -3] as const;
const rsiDivergenceMaxConsecutiveDisagreements = [1, 2, 3] as const;

const rsiDivergenceCandidates = rsiDivergenceMinAgreementScores.flatMap(
  (minAgreementScore) =>
    rsiDivergenceMaxConsecutiveDisagreements.map(
      (maxConsecutiveDisagreements) =>
        defineCandidate({
          filter: rsiDivergenceFilter,
          config: {
            rsiLength: 14,
            includeHidden: true,
            leftBars: 5,
            rightBars: 5,
            rangeLower: 5,
            rangeUpper: 60,
            maxSignalAgeBars: 20,
            minAgreementScore,
            maxConsecutiveDisagreements,
          } satisfies RsiDivergenceConfig,
        }),
    ),
);

const activeCandidates = rsiDivergenceCandidates;

export const registeredCandidatesByMarket = {
  "5m": candidatesByAsset({
    btc: activeCandidates,
    eth: activeCandidates,
    sol: activeCandidates,
    doge: activeCandidates,
  }),
  "15m": candidatesByAsset({
    btc: activeCandidates,
    eth: activeCandidates,
    sol: activeCandidates,
    doge: activeCandidates,
  }),
} as const satisfies CandidateRegistryByMarket;

export const tradeCandidatesByMarket = registeredCandidatesByMarket;

export const registeredCandidatesByPeriod = {
  "5m": uniqueCandidates(
    candidatesForRegisteredAssets(registeredCandidatesByMarket["5m"]),
  ),
  "15m": uniqueCandidates(
    candidatesForRegisteredAssets(registeredCandidatesByMarket["15m"]),
  ),
} as const satisfies CandidateRegistryByPeriod;

export const registeredCandidates = uniqueCandidates(
  Object.values(registeredCandidatesByMarket).flatMap((byAsset) =>
    candidatesForRegisteredAssets(byAsset),
  ),
);

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

function candidatesByAsset(
  byAsset: Partial<Record<Asset, readonly FilterCandidate[]>>,
): Readonly<Partial<Record<Asset, readonly FilterCandidate[]>>> {
  return registryAssets.reduce(
    (out, asset) => ({
      ...out,
      [asset]: byAsset[asset],
    }),
    {} as Partial<Record<Asset, readonly FilterCandidate[]>>,
  );
}

function candidatesForRegisteredAssets(
  byAsset: Readonly<Partial<Record<Asset, readonly FilterCandidate[]>>>,
): readonly FilterCandidate[] {
  return Object.values(byAsset).flatMap((candidates) => candidates ?? []);
}

function uniqueCandidates(
  candidates: readonly FilterCandidate[],
): readonly FilterCandidate[] {
  return [
    ...new Map(
      candidates.map((candidate) => [candidate.id, candidate]),
    ).values(),
  ];
}
