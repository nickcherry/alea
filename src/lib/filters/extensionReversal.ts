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
  version: 3,
  description:
    "Mean-reversion against a compounded extension. When the in-progress (synth) bar and the prior closed bar push the same direction with returns above their respective thresholds, bet the opposite direction. The `allowedDirection` config gates which side of the asymmetry to take — crypto's upward drift bias makes fading downward extensions reliable, while fading upward extensions tends to be coin-flip. The optional `minStreakLength` filter requires a multi-bar same-direction streak preceding the trigger. The optional `minConfluenceCount` filter requires the same extension to appear simultaneously across multiple assets (broad-market downside reverts more reliably than idiosyncratic moves) — requires the harness to populate `context.crossAssetSeries`. Lifecycle invalidates on max age, consecutive wrong bars, or an unfavorable right-vs-wrong tally.",
  sources: [pythSpotCandleSource],
  evaluate({ asset, series, crossAssetSeries, config }) {
    const match = findRecentExtensionReversal({
      bars: series.pyth,
      config,
      crossAssetSeries,
      asset,
    });
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
