import type { FilterEvaluation } from "@alea/lib/filters/types";
import type { MarketBar } from "@alea/lib/marketSeries/types";

export type ExtensionReversalAllowedDirection = "up" | "down" | "both";

export type ExtensionReversalBaseConfig = {
  readonly minSynthReturnPct: number;
  readonly minLastReturnPct: number;
  readonly maxSignalAgeBars: number;
  /**
   * Restrict trigger to one bet direction. "up" only fires when the
   * extension is downward (mean-revert up); "down" only fires when
   * the extension is upward (mean-revert down); "both" allows either.
   *
   * Crypto has an upward drift bias on 1h candles — fading downward
   * extensions reliably reverses, fading upward extensions does not.
   * Defaults to "up" by convention; explicitly set "both" to recover
   * the symmetric v1 behavior.
   */
  readonly allowedDirection: ExtensionReversalAllowedDirection;
  /**
   * Minimum number of consecutive same-direction closed bars
   * immediately preceding the synth bar (going back from `lastIndex-1`).
   * Synth and last-closed already need to align by construction, so
   * `minStreakLength` of 0 or 1 is equivalent to "no streak filter."
   */
  readonly minStreakLength: number;
};

export type ExtensionReversalTrigger = {
  readonly direction: "up" | "down";
  readonly confirmedIndex: number;
  readonly synthReturnPct: number;
  readonly lastReturnPct: number;
  readonly streakLength: number;
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
  if (
    config.allowedDirection !== "both" &&
    config.allowedDirection !== direction
  ) {
    return undefined;
  }
  const extensionDirection: "up" | "down" = synthSign > 0 ? "up" : "down";
  const streakLength = countLeadingSameDirClosed({
    bars,
    startIndex: index - 1,
    direction: extensionDirection,
  });
  if (streakLength < config.minStreakLength) {
    return undefined;
  }
  return {
    direction,
    confirmedIndex: index,
    synthReturnPct,
    lastReturnPct,
    streakLength,
  };
}

function countLeadingSameDirClosed({
  bars,
  startIndex,
  direction,
}: {
  readonly bars: readonly MarketBar[];
  readonly startIndex: number;
  readonly direction: "up" | "down";
}): number {
  let count = 0;
  for (let i = startIndex; i >= 0; i -= 1) {
    const bar = bars[i];
    if (bar === undefined) {
      break;
    }
    const dir: "up" | "down" | "flat" =
      bar.close > bar.open ? "up" : bar.close < bar.open ? "down" : "flat";
    if (dir !== direction) {
      break;
    }
    count += 1;
  }
  return count;
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
  if (
    config.allowedDirection !== "up" &&
    config.allowedDirection !== "down" &&
    config.allowedDirection !== "both"
  ) {
    throw new Error('allowedDirection must be "up", "down", or "both"');
  }
  if (
    !Number.isInteger(config.minStreakLength) ||
    config.minStreakLength < 0
  ) {
    throw new Error("minStreakLength must be a non-negative integer");
  }
}
