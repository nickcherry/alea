import type { FilterEvaluation } from "@alea/lib/filters/types";
import type { MarketBar } from "@alea/lib/marketSeries/types";

export type ExtensionReversalBaseConfig = {
  readonly minSynthReturnPct: number;
  readonly minLastReturnPct: number;
  readonly maxSignalAgeBars: number;
};

export type ExtensionReversalTrigger = {
  readonly direction: "up" | "down";
  readonly confirmedIndex: number;
  readonly synthReturnPct: number;
  readonly lastReturnPct: number;
};

export type ExtensionReversalMatch =
  | {
      readonly matched: true;
      readonly bars: readonly MarketBar[];
      readonly lastIndex: number;
      readonly trigger: ExtensionReversalTrigger;
      readonly barsAgo: number;
      readonly evaluation: FilterEvaluation;
    }
  | {
      readonly matched: false;
      readonly evaluation: FilterEvaluation;
    };

export function findRecentExtensionReversal({
  bars,
  config,
}: {
  readonly bars: readonly MarketBar[];
  readonly config: ExtensionReversalBaseConfig;
}): ExtensionReversalMatch {
  validateExtensionReversalBaseConfig(config);
  const lastIndex = bars.length - 1;
  if (lastIndex < 1) {
    return {
      matched: false,
      evaluation: {
        decision: "neutral",
        reason: "not enough bars for extension reversal",
      },
    };
  }
  const earliest = Math.max(1, lastIndex - config.maxSignalAgeBars);
  for (let i = lastIndex; i >= earliest; i -= 1) {
    const trigger = detectExtensionReversalAt({ bars, index: i, config });
    if (trigger === undefined) {
      continue;
    }
    const barsAgo = lastIndex - i;
    return {
      matched: true,
      bars,
      lastIndex,
      trigger,
      barsAgo,
      evaluation: {
        decision: trigger.direction,
        reason:
          trigger.direction === "up"
            ? `extension reversal long: compounded down-extension ${(100 * trigger.synthReturnPct).toFixed(2)}% (synth) + ${(100 * trigger.lastReturnPct).toFixed(2)}% (last) ${barsAgo} bar(s) ago`
            : `extension reversal short: compounded up-extension ${(100 * trigger.synthReturnPct).toFixed(2)}% (synth) + ${(100 * trigger.lastReturnPct).toFixed(2)}% (last) ${barsAgo} bar(s) ago`,
        metadata: {
          confirmedIndex: trigger.confirmedIndex,
          confirmedOpenTimeMs: bars[trigger.confirmedIndex]?.openTimeMs,
          synthReturnPct: trigger.synthReturnPct,
          lastReturnPct: trigger.lastReturnPct,
          barsAgo,
        },
      },
    };
  }
  return {
    matched: false,
    evaluation: {
      decision: "neutral",
      reason: "no extension reversal trigger inside recency window",
    },
  };
}

export function detectExtensionReversalAt({
  bars,
  index,
  config,
}: {
  readonly bars: readonly MarketBar[];
  readonly index: number;
  readonly config: ExtensionReversalBaseConfig;
}): ExtensionReversalTrigger | undefined {
  const synthBar = bars[index];
  const lastBar = bars[index - 1];
  if (synthBar === undefined || lastBar === undefined) {
    return undefined;
  }
  if (synthBar.open <= 0 || lastBar.open <= 0) {
    return undefined;
  }
  const synthReturnPct = (synthBar.close - synthBar.open) / synthBar.open;
  const lastReturnPct = (lastBar.close - lastBar.open) / lastBar.open;
  if (Math.abs(synthReturnPct) < config.minSynthReturnPct) {
    return undefined;
  }
  if (Math.abs(lastReturnPct) < config.minLastReturnPct) {
    return undefined;
  }
  const synthSign = Math.sign(synthReturnPct);
  const lastSign = Math.sign(lastReturnPct);
  if (synthSign === 0 || synthSign !== lastSign) {
    return undefined;
  }
  const direction: "up" | "down" = synthSign > 0 ? "down" : "up";
  return {
    direction,
    confirmedIndex: index,
    synthReturnPct,
    lastReturnPct,
  };
}

function validateExtensionReversalBaseConfig(
  config: ExtensionReversalBaseConfig,
): void {
  if (
    !Number.isFinite(config.minSynthReturnPct) ||
    config.minSynthReturnPct < 0
  ) {
    throw new Error("minSynthReturnPct must be a non-negative number");
  }
  if (
    !Number.isFinite(config.minLastReturnPct) ||
    config.minLastReturnPct < 0
  ) {
    throw new Error("minLastReturnPct must be a non-negative number");
  }
  if (
    !Number.isInteger(config.maxSignalAgeBars) ||
    config.maxSignalAgeBars < 0
  ) {
    throw new Error("maxSignalAgeBars must be a non-negative integer");
  }
}
