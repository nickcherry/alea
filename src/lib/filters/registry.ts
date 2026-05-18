import type { TradeDecisionPeriod } from "@alea/constants/tradeDecision";
import { defineCandidate } from "@alea/lib/filters/config";
import {
  type ExhaustionReversalConfig,
  exhaustionReversalFilter,
} from "@alea/lib/filters/exhaustionReversal";
import {
  type FailedBreakoutReversalConfig,
  failedBreakoutReversalFilter,
} from "@alea/lib/filters/failedBreakoutReversal";
import {
  type HtfAlignmentConfig,
  htfAlignmentFilter,
} from "@alea/lib/filters/htfAlignment";
import {
  type MaRejectionConfig,
  maRejectionFilter,
} from "@alea/lib/filters/maRejection";
import {
  type PinBarReversalConfig,
  pinBarReversalFilter,
} from "@alea/lib/filters/pinBarReversal";
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
  "xrp",
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

const oneHourExhaustionReversalCandidate = defineCandidate({
  filter: exhaustionReversalFilter,
  config: {
    emaLength: 20,
    runWindow: 5,
    minDirectionalCount: 5,
    minRunReturnPct: 0.02,
    minDistanceFromEmaPct: 0.002,
    minWickPct: 0.1,
    maxCloseLocation: 0.4,
    requireBodyShrink: false,
    maxSignalAgeBars: 3,
    maxAge: 8,
    maxConsecutiveWrong: 1,
    requireWrongLessThanRight: false,
    requireFirstTradeWin: false,
  } satisfies ExhaustionReversalConfig,
});

const oneHourMaRejectionCandidate = defineCandidate({
  filter: maRejectionFilter,
  config: {
    fastEmaLength: 20,
    midEmaLength: 50,
    slowEmaLength: 100,
    touchTolerancePct: 0.0005,
    minLowerWickPct: 0.15,
    minCloseLocation: 0.75,
    maxSignalAgeBars: 0,
    maxAge: 4,
    maxConsecutiveWrong: 1,
    requireWrongLessThanRight: false,
    requireFirstTradeWin: false,
  } satisfies MaRejectionConfig,
});

const oneHourHtfAlignmentCandidate = defineCandidate({
  filter: htfAlignmentFilter,
  config: {
    htfWindow: 4,
    minReturnPct: 0.03,
    requireSynthAlignment: true,
    maxSignalAgeBars: 0,
    maxAge: 4,
    maxConsecutiveWrong: 1,
    requireWrongLessThanRight: false,
    requireFirstTradeWin: false,
  } satisfies HtfAlignmentConfig,
});

const oneHourPinBarReversalCandidate = defineCandidate({
  filter: pinBarReversalFilter,
  config: {
    lookbackBars: 40,
    minWickPct: 0.55,
    maxBodyPct: 0.4,
    minCloseAcrossBodyPct: 0.75,
    maxSignalAgeBars: 5,
    maxAge: 8,
    maxConsecutiveWrong: 1,
    requireWrongLessThanRight: false,
    requireFirstTradeWin: false,
  } satisfies PinBarReversalConfig,
});

const baseCandidates = [
  oneHourRsiDivergenceCandidate,
  oneHourFailedBreakoutReversalCandidate,
  oneHourExhaustionReversalCandidate,
  oneHourMaRejectionCandidate,
  oneHourHtfAlignmentCandidate,
  oneHourPinBarReversalCandidate,
];

export const registeredCandidatesByMarket = {
  "1h": candidatesByAsset({
    btc: baseCandidates,
    eth: baseCandidates,
    sol: baseCandidates,
    xrp: baseCandidates,
    doge: baseCandidates,
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
