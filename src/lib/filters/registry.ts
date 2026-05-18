import type { TradeDecisionPeriod } from "@alea/constants/tradeDecision";
import { defineCandidate } from "@alea/lib/filters/config";
import {
  type FailedBreakoutReversalConfig,
  failedBreakoutReversalFilter,
} from "@alea/lib/filters/failedBreakoutReversal";
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
    minAgreementScore: 0,
    maxConsecutiveDisagreements: 1,
  } satisfies RsiDivergenceConfig,
});

const oneHourFailedBreakoutReversalCandidate = defineCandidate({
  filter: failedBreakoutReversalFilter,
  config: {
    lookbackBars: 40,
    minCloseLocation: 0.7,
    maxSignalAgeBars: 5,
    maxAge: 8,
    maxConsecutiveWrong: 1,
    requireWrongLessThanRight: false,
    requireFirstTradeWin: false,
  } satisfies FailedBreakoutReversalConfig,
});

export const registeredCandidatesByMarket = {
  "1h": candidatesByAsset({
    btc: [
      oneHourRsiDivergenceCandidate,
      oneHourFailedBreakoutReversalCandidate,
    ],
    eth: [
      oneHourRsiDivergenceCandidate,
      oneHourFailedBreakoutReversalCandidate,
    ],
    sol: [
      oneHourRsiDivergenceCandidate,
      oneHourFailedBreakoutReversalCandidate,
    ],
    doge: [
      oneHourRsiDivergenceCandidate,
      oneHourFailedBreakoutReversalCandidate,
    ],
  }),
} as const satisfies CandidateRegistryByMarket;

export const tradeCandidatesByMarket = registeredCandidatesByMarket;

export const registeredCandidatesByPeriod = {
  "1h": uniqueCandidates(
    candidatesForRegisteredAssets(registeredCandidatesByMarket["1h"]),
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
