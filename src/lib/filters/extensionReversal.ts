import {
  type ExtensionReversalBaseConfig,
  type ExtensionReversalMatch,
  findRecentExtensionReversal,
} from "@alea/lib/filters/extensionReversalCore";
import {
  runThesisLifecycle,
  type ThesisLifecycleConfig,
} from "@alea/lib/filters/thesisLifecycle";
import {
  type FilterEvaluation,
  pythSpotCandleSource,
  type TradingFilter,
} from "@alea/lib/filters/types";

export type ExtensionReversalConfig = ExtensionReversalBaseConfig &
  ThesisLifecycleConfig;

export const extensionReversalFilter: TradingFilter<ExtensionReversalConfig> = {
  id: "extension_reversal",
  name: "Extension Reversal",
  version: 1,
  description:
    "Mean-reversion against a compounded extension: when the in-progress (synth) bar and the prior closed bar are both pushing the same direction with returns above their respective thresholds, bet the opposite direction. The further price has run inside the current hour on top of an already-trending prior hour, the more likely it mean-reverts on the next hour. Lifecycle invalidates on max age, consecutive wrong bars, or an unfavorable right-vs-wrong tally.",
  sources: [pythSpotCandleSource],
  evaluate({ series, config }) {
    const match = findRecentExtensionReversal({ bars: series.pyth, config });
    return applyExtensionReversalLifecycle({ match, config });
  },
};

export function applyExtensionReversalLifecycle({
  match,
  config,
}: {
  readonly match: ExtensionReversalMatch;
  readonly config: ThesisLifecycleConfig;
}): FilterEvaluation {
  if (!match.matched) {
    return match.evaluation;
  }
  const lifecycle = runThesisLifecycle({
    direction: match.trigger.direction,
    confirmedIndex: match.trigger.confirmedIndex,
    bars: match.bars,
    lastIndex: match.lastIndex,
    config,
  });
  const baseMetadata = match.evaluation.metadata ?? {};
  if (lifecycle.invalidated) {
    return {
      decision: "neutral",
      reason: lifecycle.reason ?? "extension reversal invalidated",
      metadata: { ...baseMetadata, ...lifecycle.metadata },
    };
  }
  return {
    ...match.evaluation,
    metadata: { ...baseMetadata, ...lifecycle.metadata },
  };
}
