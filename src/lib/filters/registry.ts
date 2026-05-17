import type { TradeDecisionPeriod } from "@alea/constants/tradeDecision";
import { defineCandidate } from "@alea/lib/filters/config";
import {
  type RangeBreakoutFadeConfig,
  rangeBreakoutFadeFilter,
} from "@alea/lib/filters/rangeBreakoutFade";
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

const baseRangeBreakoutFadeConfig = {
  lookbackBars: 24,
  minBreakBps: 5,
  closeLocationThreshold: 0.65,
  atrBars: 20,
  minActiveRangeAtrFraction: 0.9,
  priorTrendBars: 24,
  maxPriorTrendBps: 100,
} as const satisfies RangeBreakoutFadeConfig;

const rangeBreakoutFadeCandidates = {
  btc5m: defineCandidate({
    filter: rangeBreakoutFadeFilter,
    config: {
      ...baseRangeBreakoutFadeConfig,
      maxBreakBps: 30,
      maxActiveMoveBps: 25,
      sidePriorTrendCaps: [
        { bars: 12, maxBps: 100 },
        { bars: 24, maxBps: 50 },
      ],
      compressionBars: 12,
      compressionDistanceBps: 20,
      maxCompressionCount: 5,
    } satisfies RangeBreakoutFadeConfig,
  }),
  eth5m: defineCandidate({
    filter: rangeBreakoutFadeFilter,
    config: {
      ...baseRangeBreakoutFadeConfig,
      maxBreakBps: 30,
      maxActiveMoveBps: 40,
      maxActiveRangeAtrFraction: 3,
      sidePriorTrendCaps: [{ bars: 24, maxBps: 100 }],
      compressionBars: 12,
      compressionDistanceBps: 20,
      maxCompressionCount: 1,
    } satisfies RangeBreakoutFadeConfig,
  }),
  btc15m: defineCandidate({
    filter: rangeBreakoutFadeFilter,
    config: {
      ...baseRangeBreakoutFadeConfig,
      maxBreakBps: 60,
      maxActiveMoveBps: 90,
      sidePriorTrendCaps: [{ bars: 24, maxBps: 100 }],
      compressionBars: 12,
      compressionDistanceBps: 20,
      maxCompressionCount: 1,
    } satisfies RangeBreakoutFadeConfig,
  }),
  eth15m: defineCandidate({
    filter: rangeBreakoutFadeFilter,
    config: {
      ...baseRangeBreakoutFadeConfig,
      maxBreakBps: 90,
    } satisfies RangeBreakoutFadeConfig,
  }),
  sol15m: defineCandidate({
    filter: rangeBreakoutFadeFilter,
    config: {
      ...baseRangeBreakoutFadeConfig,
      maxBreakBps: 90,
      maxActiveMoveBps: 90,
      sidePriorTrendCaps: [{ bars: 24, maxBps: 100 }],
      compressionBars: 12,
      compressionDistanceBps: 20,
      maxCompressionCount: 1,
    } satisfies RangeBreakoutFadeConfig,
  }),
} as const;

export const registeredCandidatesByMarket = {
  "5m": candidatesByAsset({
    btc: [rangeBreakoutFadeCandidates.btc5m],
    eth: [rangeBreakoutFadeCandidates.eth5m],
    sol: [],
    doge: [],
  }),
  "15m": candidatesByAsset({
    btc: [rangeBreakoutFadeCandidates.btc15m],
    eth: [rangeBreakoutFadeCandidates.eth15m],
    sol: [rangeBreakoutFadeCandidates.sol15m],
    doge: [],
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
