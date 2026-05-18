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

const RSI_DIVERGENCE_CONFIG: RsiDivergenceConfig = {
  rsiLength: 21,
  includeHidden: true,
  leftBars: 2,
  rightBars: 2,
  rangeLower: 2,
  rangeUpper: 30,
  maxSignalAgeBars: 13,
};

// Sweep grid: TP must be >= 2% (operator floor). SL widens above TP
// so a healthy WR is plausible. Outcome window varies from short
// scalps (5 bars / 5h) to multi-day holds (48 bars / 2 days).
const RSI_DIVERGENCE_TP_PCTS = [0.02, 0.025, 0.03, 0.04, 0.05] as const;
const RSI_DIVERGENCE_SL_PCTS = [0.02, 0.03, 0.05, 0.08] as const;
const RSI_DIVERGENCE_WINDOW_BARS = [5, 10, 24, 48] as const;

const rsiDivergenceCandidates: readonly FilterCandidate[] = (() => {
  const out: FilterCandidate[] = [];
  for (const takeProfitPct of RSI_DIVERGENCE_TP_PCTS) {
    for (const stopLossPct of RSI_DIVERGENCE_SL_PCTS) {
      for (const outcomeWindowBars of RSI_DIVERGENCE_WINDOW_BARS) {
        out.push(
          defineCandidate({
            filter: rsiDivergenceFilter,
            config: RSI_DIVERGENCE_CONFIG,
            takeProfitPct,
            stopLossPct,
            outcomeWindowBars,
          }),
        );
      }
    }
  }
  return out;
})();

const baseCandidates: readonly FilterCandidate[] = rsiDivergenceCandidates;

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
