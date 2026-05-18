import type { CrossAssetSeries, FilterEvaluation } from "@alea/lib/filters/types";
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
  /**
   * Minimum number of assets (INCLUDING the asset being evaluated) that
   * must simultaneously fire a same-direction extension trigger for the
   * confluence gate to pass. Set to `0` or `1` to disable the gate. The
   * confluence check uses `confluenceMinSynthReturnPct` and
   * `confluenceMinLastReturnPct` (which usually mirror the primary
   * thresholds) and treats other assets' synth direction symmetrically:
   * for a long-only "up" trigger, we count other assets whose own synth
   * is *also* extending downward (same as the asset under evaluation).
   *
   * Requires the harness to populate `context.crossAssetSeries`. When it
   * doesn't, the filter fails closed (returns neutral) so a missing
   * source can never silently pass the gate.
   */
  readonly minConfluenceCount: number;
  readonly confluenceMinSynthReturnPct: number;
  readonly confluenceMinLastReturnPct: number;
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
  crossAssetSeries,
  asset,
}: {
  readonly bars: readonly MarketBar[];
  readonly config: ExtensionReversalBaseConfig;
  readonly crossAssetSeries?: CrossAssetSeries;
  readonly asset?: string;
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
    let confluenceCount = 1;
    if (config.minConfluenceCount > 1) {
      if (crossAssetSeries === undefined) {
        return {
          matched: false,
          evaluation: {
            decision: "neutral",
            reason:
              "extension reversal needs cross-asset confluence but harness did not supply crossAssetSeries (failing closed)",
          },
        };
      }
      const extensionDirection: "up" | "down" =
        trigger.direction === "up" ? "down" : "up";
      for (const [otherAsset, otherSeries] of Object.entries(crossAssetSeries)) {
        if (otherAsset === asset || otherSeries === undefined) {
          continue;
        }
        if (
          assetIsSimultaneouslyExtending({
            bars: otherSeries.pyth,
            extensionDirection,
            minSynthReturnPct: config.confluenceMinSynthReturnPct,
            minLastReturnPct: config.confluenceMinLastReturnPct,
          })
        ) {
          confluenceCount += 1;
        }
      }
      if (confluenceCount < config.minConfluenceCount) {
        continue;
      }
    }
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
            ? `extension reversal long: compounded down-extension ${(100 * trigger.synthReturnPct).toFixed(2)}% (synth) + ${(100 * trigger.lastReturnPct).toFixed(2)}% (last) ${barsAgo} bar(s) ago${config.minConfluenceCount > 1 ? ` (confluence=${confluenceCount})` : ""}`
            : `extension reversal short: compounded up-extension ${(100 * trigger.synthReturnPct).toFixed(2)}% (synth) + ${(100 * trigger.lastReturnPct).toFixed(2)}% (last) ${barsAgo} bar(s) ago${config.minConfluenceCount > 1 ? ` (confluence=${confluenceCount})` : ""}`,
        metadata: {
          confirmedIndex: trigger.confirmedIndex,
          confirmedOpenTimeMs: bars[trigger.confirmedIndex]?.openTimeMs,
          synthReturnPct: trigger.synthReturnPct,
          lastReturnPct: trigger.lastReturnPct,
          barsAgo,
          confluenceCount,
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

function assetIsSimultaneouslyExtending({
  bars,
  extensionDirection,
  minSynthReturnPct,
  minLastReturnPct,
}: {
  readonly bars: readonly MarketBar[];
  readonly extensionDirection: "up" | "down";
  readonly minSynthReturnPct: number;
  readonly minLastReturnPct: number;
}): boolean {
  const lastIndex = bars.length - 1;
  if (lastIndex < 1) return false;
  const synthBar = bars[lastIndex];
  const lastBar = bars[lastIndex - 1];
  if (synthBar === undefined || lastBar === undefined) return false;
  if (synthBar.open <= 0 || lastBar.open <= 0) return false;
  const synthRet = (synthBar.close - synthBar.open) / synthBar.open;
  const lastRet = (lastBar.close - lastBar.open) / lastBar.open;
  if (Math.abs(synthRet) < minSynthReturnPct) return false;
  if (Math.abs(lastRet) < minLastReturnPct) return false;
  const synthSign = Math.sign(synthRet);
  const lastSign = Math.sign(lastRet);
  if (synthSign === 0 || synthSign !== lastSign) return false;
  const otherExt: "up" | "down" = synthSign > 0 ? "up" : "down";
  return otherExt === extensionDirection;
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
  if (
    !Number.isInteger(config.minConfluenceCount) ||
    config.minConfluenceCount < 0
  ) {
    throw new Error("minConfluenceCount must be a non-negative integer");
  }
  if (
    !Number.isFinite(config.confluenceMinSynthReturnPct) ||
    config.confluenceMinSynthReturnPct < 0
  ) {
    throw new Error("confluenceMinSynthReturnPct must be a non-negative number");
  }
  if (
    !Number.isFinite(config.confluenceMinLastReturnPct) ||
    config.confluenceMinLastReturnPct < 0
  ) {
    throw new Error("confluenceMinLastReturnPct must be a non-negative number");
  }
}
