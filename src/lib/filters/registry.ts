import { defineCandidate } from "@alea/lib/filters/config";
import { rsiDivergenceFilter } from "@alea/lib/filters/rsiDivergence";
import { smaTrendFilter } from "@alea/lib/filters/smaTrend";
import { wickRejectionFilter } from "@alea/lib/filters/wickRejection";

export const registeredCandidates = [
  defineCandidate({
    filter: smaTrendFilter,
    config: {
      fastLength: 20,
      slowLength: 50,
      minSpreadBps: 0,
      requireCloseConfirmation: true,
    },
  }),
  defineCandidate({
    filter: smaTrendFilter,
    config: {
      fastLength: 9,
      slowLength: 21,
      minSpreadBps: 1.5,
      requireCloseConfirmation: true,
    },
  }),
  defineCandidate({
    filter: rsiDivergenceFilter,
    config: {
      rsiLength: 14,
      includeHidden: false,
      leftBars: 5,
      rightBars: 5,
      minPivotDistance: 8,
      maxPivotDistance: 60,
      signalLookbackBars: 8,
    },
  }),
  defineCandidate({
    filter: rsiDivergenceFilter,
    config: {
      rsiLength: 14,
      includeHidden: true,
      leftBars: 5,
      rightBars: 5,
      minPivotDistance: 8,
      maxPivotDistance: 60,
      signalLookbackBars: 8,
    },
  }),
  defineCandidate({
    filter: wickRejectionFilter,
    config: {
      lookbackBars: 24,
      minWickToRange: 0.6,
      signalLookbackBars: 4,
    },
  }),
] as const;
